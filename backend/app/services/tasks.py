"""Task permissions and writes shared by direct HTTP and queued mutations."""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.core.errors import AppError
from app.models.family import Member
from app.models.task import Task
from app.schemas.tasks import TaskOut, TaskWrite
from app.services import storage
from app.services.clock import utcnow
from app.services.common import is_admin
from app.services.inventory import clean_opt_text, clean_title


def task_out(row: Task) -> TaskOut:
    return TaskOut(
        id=str(row.id),
        title=row.title,
        description=row.description,
        assignee_id=str(row.assignee_id) if row.assignee_id else None,
        due_date=row.due_date,
        completed=row.completed,
        completed_at=row.completed_at,
        completed_by=str(row.completed_by) if row.completed_by else None,
        completion_photo_url=row.completion_photo_url,
        created_by=str(row.created_by) if row.created_by else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_for_family(db: Session, actor: Member) -> list[TaskOut]:
    rows = db.scalars(
        select(Task)
        .where(Task.family_id == actor.family_id)
        .order_by(Task.completed, Task.due_date.asc().nulls_last(), Task.created_at.desc(), Task.id)
        .execution_options(populate_existing=True)
    )
    return [task_out(row) for row in rows]


def assert_permission(actor: Member, row: Task, action: str) -> None:
    allowed = is_admin(actor) or row.created_by == actor.id
    if action == "complete":
        allowed = allowed or row.assignee_id == actor.id
    if not allowed:
        raise AppError("TASK_FORBIDDEN", "اجازهٔ تغییر این کار را ندارید.", 403)


def prepare(db: Session, actor: Member, body: TaskWrite) -> dict:
    assignee = body.assignee_id
    if assignee is not None:
        member = db.scalar(
            select(Member).where(
                Member.id == assignee,
                Member.family_id == actor.family_id,
                or_(
                    Member.status == "active",
                    and_(Member.status == "pending", Member.relation == "فرزند"),
                ),
                Member.membership_state == "active",
            )
        )
        if member is None:
            raise AppError("INVALID_ASSIGNEE", "مسئول باید عضو فعال همین خانواده باشد.", 422)
    return {
        "title": clean_title(body.title, "عنوان کار"),
        "description": clean_opt_text(body.description, 2000, "توضیح"),
        "assignee_id": assignee,
        "due_date": body.due_date,
    }


def create_row(
    db: Session, actor: Member, body: TaskWrite, entity_id: uuid.UUID | None = None
) -> Task:
    row = Task(
        id=entity_id or uuid.uuid4(),
        family_id=actor.family_id,
        created_by=actor.id,
        **prepare(db, actor, body),
    )
    db.add(row)
    return row


def change_row(db: Session, actor: Member, row: Task, action: str, data: dict) -> Task | None:
    assert_permission(actor, row, action)
    if action == "delete":
        db.delete(row)
        return None
    if action == "complete":
        photo = data.get("completion_photo")
        if photo is not None:
            # This follows the same permission and revision checks as completion.
            # A content-based path is stable if a failed commit must be retried.
            storage.require_configured()
            image = storage.decode_data_url(photo, settings.upload_max_bytes)
            digest = hashlib.sha256(image.data).hexdigest()
            path = f"task-photos/{row.family_id}/{row.id}/{digest}.{image.ext}"
            storage.get_storage().save(path, image.data)
            row.completion_photo_url = storage.build_url(path)
        if row.completed != data["completed"]:
            row.completed = data["completed"]
            row.completed_at = utcnow() if row.completed else None
            row.completed_by = actor.id if row.completed else None
        if not row.completed:
            row.completion_photo_url = None
        # One acknowledged no-op still advances the revision, just like shopping.
        flag_modified(row, "completed")
    else:
        for field, value in prepare(db, actor, TaskWrite(**data)).items():
            setattr(row, field, value)
        flag_modified(row, "title")
    row.updated_at = utcnow()
    return row


def locked_task(db: Session, actor: Member, task_id: uuid.UUID, revision: int, action: str) -> Task:
    row = db.scalar(
        select(Task)
        .where(Task.id == task_id, Task.family_id == actor.family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise AppError("NOT_FOUND", "کار یافت نشد.", 404)
    assert_permission(actor, row, action)
    if row.revision != revision:
        raise AppError("SYNC_CONFLICT", "این کار تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409)
    return row


def create(db: Session, actor: Member, body: TaskWrite) -> TaskOut:
    row = create_row(db, actor, body)
    db.commit()
    db.refresh(row)
    return task_out(row)


def change(
    db: Session, actor: Member, task_id: uuid.UUID, revision: int, action: str, data: dict
) -> TaskOut | None:
    row = locked_task(db, actor, task_id, revision, action)
    result = change_row(db, actor, row, action, data)
    db.commit()
    if result is None:
        return None
    db.refresh(result)
    return task_out(result)
