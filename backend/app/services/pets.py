"""Manager-owned pet profiles with idempotent canonical Task care creation."""

from __future__ import annotations

import logging
import uuid

import jdatetime
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.family import Family, Member
from app.models.pet import Pet
from app.models.task import Task
from app.schemas.pets import (
    PetCareOut,
    PetCareWrite,
    PetDetailOut,
    PetListOut,
    PetOut,
    PetUpdate,
    PetWrite,
)
from app.schemas.tasks import TaskWrite
from app.services import tasks
from app.services.common import is_admin
from app.services.member_age import today_tehran

logger = logging.getLogger(__name__)
_MAX_PETS = 100


def require_active(actor: Member) -> None:
    if actor.status != "active" or actor.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)


def _require_manager(actor: Member) -> None:
    require_active(actor)
    if not is_admin(actor):
        raise AppError(
            "PET_FORBIDDEN", "فقط مدیر خانواده می‌تواند مشخصات و مراقبت حیوان را ثبت کند.", 403
        )


def _get(db: Session, actor: Member, pet_id: uuid.UUID, *, lock: bool = False) -> Pet:
    require_active(actor)
    query = (
        select(Pet)
        .where(Pet.id == pet_id, Pet.family_id == actor.family_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        visible = db.scalar(query)
        if visible is not None:
            _require_manager(actor)
        query = query.with_for_update()
    row = db.scalar(query)
    if row is None:
        raise AppError("NOT_FOUND", "حیوان یافت نشد.", 404)
    return row


def _authorize(actor: Member, row: Pet, revision: int) -> None:
    _require_manager(actor)
    if row.revision != revision:
        raise AppError(
            "SYNC_CONFLICT", "مشخصات حیوان تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409
        )


def _out(row: Pet, actor: Member) -> PetOut:
    return PetOut(
        id=str(row.id),
        name=row.name,
        species=row.species,
        breed=row.breed,
        birth_date=row.birth_date,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=is_admin(actor),
        can_delete=is_admin(actor),
    )


def _care_out(row: Task, actor: Member) -> PetCareOut:
    return PetCareOut(
        id=str(row.id),
        title=row.title,
        assignee_id=str(row.assignee_id) if row.assignee_id else None,
        due_date=row.due_date,
        completed=row.completed,
        revision=row.revision,
        can_complete=is_admin(actor) or row.created_by == actor.id or row.assignee_id == actor.id,
    )


def _values(body: PetWrite) -> dict:
    name = " ".join(body.name.split())
    species = " ".join(body.species.split())
    if not name or not species:
        raise AppError("INVALID_INPUT", "نام و نوع حیوان لازم است.", 422)
    if body.birth_date is not None:
        if body.birth_date > today_tehran():
            raise AppError("INVALID_BIRTH_DATE", "تاریخ تولد نمی‌تواند در آینده باشد.", 422)
        try:
            jdatetime.date.fromgregorian(date=body.birth_date)
        except (ValueError, OverflowError):
            raise AppError(
                "INVALID_BIRTH_DATE", "تاریخ تولد در محدودهٔ تقویم معتبر نیست.", 422
            ) from None
    return {
        "name": name,
        "species": species,
        "breed": " ".join((body.breed or "").split()) or None,
        "birth_date": body.birth_date,
    }


def _audit(action: str, actor: Member, pet_id: uuid.UUID, task_id: uuid.UUID | None = None) -> None:
    logger.info(
        "pets action=%s actor=%s pet=%s task=%s", action, actor.id, pet_id, task_id or "none"
    )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except DBAPIError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlstate", None) == "42501":
            raise AppError(
                "PET_FORBIDDEN", "اجازهٔ ثبت یا تغییر مشخصات حیوان را ندارید.", 403
            ) from None
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) in {
            "fk_pet_creator_family",
            "fk_task_pet_family",
        }:
            raise AppError(
                "SYNC_CONFLICT", "اطلاعات مرتبط تغییر کرده‌اند؛ دوباره بررسی کنید.", 409
            ) from None
        raise


def list_pets(db: Session, actor: Member) -> PetListOut:
    require_active(actor)
    rows = db.scalars(
        select(Pet)
        .where(Pet.family_id == actor.family_id)
        .order_by(Pet.name, Pet.created_at, Pet.id)
    )
    return PetListOut(pets=[_out(row, actor) for row in rows], can_create=is_admin(actor))


def get(db: Session, actor: Member, pet_id: uuid.UUID) -> PetDetailOut:
    row = _get(db, actor, pet_id)
    care = db.scalars(
        select(Task)
        .where(Task.family_id == actor.family_id, Task.pet_id == row.id)
        .order_by(Task.completed, Task.due_date.asc().nulls_last(), Task.created_at, Task.id)
    )
    return PetDetailOut(
        pet=_out(row, actor),
        care_tasks=[_care_out(task, actor) for task in care],
        can_create_care=is_admin(actor),
    )


def create(db: Session, actor: Member, body: PetWrite) -> PetOut:
    _require_manager(actor)
    values = _values(body)
    db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    count = db.scalar(select(func.count()).select_from(Pet).where(Pet.family_id == actor.family_id))
    if count >= _MAX_PETS:
        raise AppError("LIMIT_REACHED", "تعداد حیوانات خانواده به سقف رسیده است.", 409)
    row = Pet(family_id=actor.family_id, created_by=actor.id, **values)
    db.add(row)
    _commit(db)
    db.refresh(row)
    _audit("create", actor, row.id)
    return _out(row, actor)


def update(db: Session, actor: Member, pet_id: uuid.UUID, body: PetUpdate) -> PetOut:
    row = _get(db, actor, pet_id, lock=True)
    _authorize(actor, row, body.base_revision)
    for field, value in _values(body).items():
        setattr(row, field, value)
    flag_modified(row, "name")
    _commit(db)
    db.refresh(row)
    _audit("update", actor, row.id)
    return _out(row, actor)


def remove(db: Session, actor: Member, pet_id: uuid.UUID, revision: int) -> None:
    row = _get(db, actor, pet_id, lock=True)
    _authorize(actor, row, revision)
    db.delete(row)
    _commit(db)
    _audit("delete", actor, pet_id)


def create_care(db: Session, actor: Member, pet_id: uuid.UUID, body: PetCareWrite) -> PetCareOut:
    row = _get(db, actor, pet_id, lock=True)
    _require_manager(actor)
    existing = db.scalar(
        select(Task)
        .where(
            Task.id == body.operation_id,
            Task.family_id == actor.family_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if existing is not None:
        if existing.pet_id != row.id or existing.created_by != actor.id:
            raise AppError(
                "OPERATION_REUSED", "این شناسه قبلاً برای کار دیگری استفاده شده است.", 409
            )
        _audit("care_replay", actor, row.id, existing.id)
        return _care_out(existing, actor)
    _authorize(actor, row, body.base_revision)
    task_body = TaskWrite.model_validate(body.model_dump(exclude={"base_revision", "operation_id"}))
    task = tasks.create_row(db, actor, task_body, entity_id=body.operation_id)
    task.pet_id = row.id
    try:
        # SessionLocal autoflush=False; save the canonical Task and its FK atomically.
        db.flush([task])
        db.commit()
    except IntegrityError:
        db.rollback()
        # A hidden foreign-family UUID collision is indistinguishable from any reused ID.
        raise AppError(
            "OPERATION_REUSED", "این شناسه با اطلاعات فعلی سازگار نیست؛ دوباره بررسی کنید.", 409
        ) from None
    db.refresh(task)
    _audit("care_create", actor, row.id, task.id)
    return _care_out(task, actor)
