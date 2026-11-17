"""Children are canonical members, with only authorized shared summaries exposed."""

from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.activity_participant import ActivityParticipant
from app.models.event import FamilyEvent
from app.models.family import Member
from app.models.task import Task
from app.schemas.children import (
    ChildActivityOut,
    ChildBirthdayOut,
    ChildDetailOut,
    ChildListOut,
    ChildOut,
    ChildTaskOut,
    ChildUpdate,
    ChildWrite,
)
from app.services.birthday_dates import age_years_on_day
from app.services.common import is_admin
from app.services.events import _event_sort_key, reconcile_member_birthday
from app.services.member_age import preserve_document_eligibility, today_tehran

logger = logging.getLogger(__name__)


def require_active(actor: Member) -> None:
    if actor.status != "active" or actor.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)


def _require_manager(actor: Member) -> None:
    require_active(actor)
    if not is_admin(actor):
        raise AppError(
            "CHILD_FORBIDDEN", "فقط مدیر خانواده می‌تواند مشخصات فرزند را تغییر دهد.", 403
        )


def _get(db: Session, actor: Member, child_id: uuid.UUID, *, lock: bool = False) -> Member:
    require_active(actor)
    query = (
        select(Member)
        .where(
            Member.id == child_id,
            Member.family_id == actor.family_id,
            Member.relation == "فرزند",
            Member.membership_state == "active",
            Member.status.in_(("active", "pending")),
        )
        .execution_options(populate_existing=True)
    )
    if lock:
        query = query.with_for_update()
    child = db.scalar(query)
    if child is None:
        raise AppError("NOT_FOUND", "فرزند یافت نشد.", 404)
    return child


def _age_years(birth: date | None, today: date) -> int | None:
    if birth is None or birth > today:
        return None
    try:
        return age_years_on_day(birth, today)
    except (ValueError, OverflowError):
        return None


def _out(child: Member, actor: Member) -> ChildOut:
    return ChildOut(
        id=str(child.id),
        name=child.name,
        birth_date=child.birth_date,
        age_years=_age_years(child.birth_date, today_tehran()),
        status=child.status,
        revision=child.profile_revision,
        can_edit=is_admin(actor),
    )


def _values(body: ChildWrite) -> tuple[str, date | None]:
    name = " ".join(body.name.split())
    if not name:
        raise AppError("INVALID_INPUT", "نام فرزند لازم است.", 422)
    if body.birth_date is not None and body.birth_date > today_tehran():
        raise AppError("INVALID_BIRTH_DATE", "تاریخ تولد نمی‌تواند در آینده باشد.", 422)
    if body.birth_date is not None:
        try:
            age_years_on_day(body.birth_date, today_tehran())
        except (ValueError, OverflowError):
            raise AppError(
                "INVALID_BIRTH_DATE", "تاریخ تولد در محدودهٔ تقویم معتبر نیست.", 422
            ) from None
    return name, body.birth_date


def _audit(action: str, actor: Member, child: Member) -> None:
    logger.info("children action=%s actor=%s child=%s", action, actor.id, child.id)


def list_children(db: Session, actor: Member) -> ChildListOut:
    require_active(actor)
    rows = db.scalars(
        select(Member)
        .where(
            Member.family_id == actor.family_id,
            Member.relation == "فرزند",
            Member.membership_state == "active",
            Member.status.in_(("active", "pending")),
        )
        .order_by(Member.created_at, Member.id)
        .execution_options(populate_existing=True)
    )
    return ChildListOut(children=[_out(row, actor) for row in rows], can_create=is_admin(actor))


def get(db: Session, actor: Member, child_id: uuid.UUID) -> ChildDetailOut:
    child = _get(db, actor, child_id)
    tasks = db.execute(
        select(Task.id, Task.title, Task.due_date, Task.completed)
        .where(Task.family_id == actor.family_id, Task.assignee_id == child.id)
        .order_by(Task.completed, Task.due_date.asc().nulls_last(), Task.created_at, Task.id)
    )
    activities = list(
        db.scalars(
            select(FamilyEvent)
            .join(
                ActivityParticipant,
                (ActivityParticipant.activity_id == FamilyEvent.id)
                & (ActivityParticipant.family_id == FamilyEvent.family_id),
            )
            .where(
                FamilyEvent.family_id == actor.family_id,
                FamilyEvent.kind == "activity",
                ActivityParticipant.family_id == actor.family_id,
                ActivityParticipant.member_id == child.id,
            )
        )
    )
    activities.sort(key=lambda row: _event_sort_key(row, today_tehran()))
    birthday = db.execute(
        select(FamilyEvent.id, FamilyEvent.title, FamilyEvent.date)
        .where(
            FamilyEvent.family_id == actor.family_id,
            FamilyEvent.kind == "event",
            FamilyEvent.for_member_id == child.id,
            FamilyEvent.title.like("تولد%"),
        )
        .order_by(FamilyEvent.created_at, FamilyEvent.id)
        .limit(1)
    ).first()
    return ChildDetailOut(
        child=_out(child, actor),
        tasks=[
            ChildTaskOut(
                id=str(row.id), title=row.title, due_date=row.due_date, completed=row.completed
            )
            for row in tasks
        ],
        activities=[
            ChildActivityOut(
                id=str(row.id),
                title=row.title,
                date=row.date,
                location=row.location,
                status=row.activity_status,
            )
            for row in activities
        ],
        birthday=(
            ChildBirthdayOut(id=str(birthday.id), title=birthday.title, date=birthday.date)
            if birthday is not None
            else None
        ),
    )


def create(db: Session, actor: Member, body: ChildWrite) -> ChildOut:
    _require_manager(actor)
    name, birth_date = _values(body)
    child = Member(
        id=uuid.uuid4(),
        family_id=actor.family_id,
        name=name,
        birth_date=birth_date,
        phone=None,
        password_hash=None,
        status="pending",
        role="member",
        relation="فرزند",
        membership_state="active",
    )
    preserve_document_eligibility(child, birth_date, "فرزند")
    db.add(child)
    reconcile_member_birthday(db, actor, child)
    db.commit()
    db.refresh(child)
    _audit("create", actor, child)
    return _out(child, actor)


def update(db: Session, actor: Member, child_id: uuid.UUID, body: ChildUpdate) -> ChildOut:
    require_active(actor)
    child = _get(db, actor, child_id, lock=True)
    _require_manager(actor)
    if child.profile_revision != body.base_revision:
        raise AppError(
            "SYNC_CONFLICT", "مشخصات فرزند تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409
        )
    name, birth_date = _values(body)
    preserve_document_eligibility(child, birth_date, child.relation)
    child.name = name
    child.birth_date = birth_date
    # Acknowledged editor saves, including no-ops, have one new profile revision.
    flag_modified(child, "name")
    reconcile_member_birthday(db, actor, child)
    db.commit()
    db.refresh(child)
    _audit("update", actor, child)
    return _out(child, actor)
