"""Tenant-bound equipment, safe links and atomic idempotent service completion."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.document import HouseholdDocument
from app.models.equipment import Equipment, MaintenanceRecord
from app.models.family import Family, Member
from app.models.task import Task
from app.schemas.equipment import (
    EquipmentOut,
    EquipmentUpdate,
    EquipmentWrite,
    MaintenanceOut,
    MaintenanceResult,
    MaintenanceWrite,
)
from app.services.common import is_admin
from app.services.documents import require_adult
from app.services.inventory import clean_opt_text, clean_title
from app.services.maintenance import authorize_target, complete_service, get_target, request_hash
from app.services.member_age import document_age_restricted, today_tehran

logger = logging.getLogger(__name__)
_MAX_EQUIPMENT = 200
_MAX_SERVICES = 500


def _audit(action: str, actor: Member, equipment_id: object) -> None:
    logger.info("equipment action=%s actor=%s equipment=%s", action, actor.id, equipment_id)


def _allowed(actor: Member, row: Equipment) -> bool:
    return is_admin(actor) or row.created_by == actor.id


def _authorize(actor: Member, row: Equipment, revision: int | None = None) -> None:
    authorize_target(
        actor,
        row,
        "EQUIPMENT_FORBIDDEN",
        "اجازهٔ تغییر این وسیله یا ثبت سرویس را ندارید.",
        "این وسیله تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.",
        revision,
    )


def _get(db: Session, actor: Member, equipment_id: uuid.UUID, *, lock: bool = False) -> Equipment:
    return get_target(db, actor, Equipment, equipment_id, "وسیله یافت نشد.", lock=lock)


def _visible_document_ids(db: Session, actor: Member, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    if not ids or document_age_restricted(actor):
        return set()
    return set(
        db.scalars(
            select(HouseholdDocument.id).where(
                HouseholdDocument.id.in_(ids),
                HouseholdDocument.family_id == actor.family_id,
                HouseholdDocument.visibility == "shared",
            )
        )
    )


def _out(row: Equipment, actor: Member, document_ids: set[uuid.UUID]) -> EquipmentOut:
    return EquipmentOut(
        id=str(row.id),
        title=row.title,
        brand=row.brand,
        model=row.model,
        purchase_date=row.purchase_date,
        warranty_until=row.warranty_until,
        warranty_document_id=(
            str(row.warranty_document_id) if row.warranty_document_id in document_ids else None
        ),
        service_task_id=str(row.service_task_id) if row.service_task_id else None,
        service_due_date=row.service_due_date,
        service_reminder_enabled=row.service_reminder_enabled,
        created_by=str(row.created_by) if row.created_by else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=_allowed(actor, row),
        can_delete=_allowed(actor, row),
    )


def _one_out(db: Session, actor: Member, row: Equipment) -> EquipmentOut:
    ids = {row.warranty_document_id} if row.warranty_document_id else set()
    return _out(row, actor, _visible_document_ids(db, actor, ids))


def _record_out(row: MaintenanceRecord) -> MaintenanceOut:
    return MaintenanceOut(
        id=str(row.id),
        equipment_id=str(row.equipment_id),
        performed_on=row.performed_on,
        description=row.description,
        next_due_date=row.next_due_date,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
    )


def _values(db: Session, actor: Member, body: EquipmentWrite) -> dict:
    values = body.model_dump(exclude={"base_revision"})
    values["title"] = clean_title(body.title, "نام وسیله")
    values["brand"] = clean_opt_text(body.brand, 80, "برند")
    values["model"] = clean_opt_text(body.model, 80, "مدل")
    if body.warranty_document_id:
        require_adult(actor, "link", body.warranty_document_id)
        if body.warranty_document_id not in _visible_document_ids(
            db, actor, {body.warranty_document_id}
        ):
            raise AppError("NOT_FOUND", "سند مشترک و مجاز یافت نشد.", 404)
    if (
        body.service_task_id
        and db.scalar(
            select(Task.id).where(
                Task.id == body.service_task_id, Task.family_id == actor.family_id
            )
        )
        is None
    ):
        raise AppError("NOT_FOUND", "کار مرتبط یافت نشد.", 404)
    return values


def _commit_links(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) in {
            "fk_equipment_document_family",
            "fk_equipment_task_family",
        }:
            raise AppError(
                "SYNC_CONFLICT", "سند یا کار مرتبط تغییر کرده است؛ دوباره انتخاب کنید.", 409
            ) from None
        raise


def list_equipment(db: Session, actor: Member) -> list[EquipmentOut]:
    rows = list(
        db.scalars(
            select(Equipment)
            .where(Equipment.family_id == actor.family_id)
            .order_by(Equipment.title, Equipment.created_at, Equipment.id)
        )
    )
    document_ids = _visible_document_ids(
        db, actor, {row.warranty_document_id for row in rows if row.warranty_document_id}
    )
    return [_out(row, actor, document_ids) for row in rows]


def create(db: Session, actor: Member, body: EquipmentWrite) -> EquipmentOut:
    values = _values(db, actor, body)
    db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    count = db.scalar(
        select(func.count()).select_from(Equipment).where(Equipment.family_id == actor.family_id)
    )
    if count >= _MAX_EQUIPMENT:
        raise AppError("LIMIT_REACHED", "تعداد وسایل خانه به سقف رسیده است.", 409)
    row = Equipment(family_id=actor.family_id, created_by=actor.id, **values)
    db.add(row)
    _commit_links(db)
    db.refresh(row)
    _audit("create", actor, row.id)
    return _one_out(db, actor, row)


def update(
    db: Session, actor: Member, equipment_id: uuid.UUID, body: EquipmentUpdate
) -> EquipmentOut:
    row = _get(db, actor, equipment_id, lock=True)
    _authorize(actor, row, body.base_revision)
    for field, value in _values(db, actor, body).items():
        setattr(row, field, value)
    flag_modified(row, "title")
    _commit_links(db)
    db.refresh(row)
    _audit("update", actor, row.id)
    return _one_out(db, actor, row)


def remove(db: Session, actor: Member, equipment_id: uuid.UUID, revision: int) -> None:
    row = _get(db, actor, equipment_id, lock=True)
    _authorize(actor, row, revision)
    db.delete(row)
    db.commit()
    _audit("delete", actor, equipment_id)


def list_services(db: Session, actor: Member, equipment_id: uuid.UUID) -> list[MaintenanceOut]:
    _get(db, actor, equipment_id)
    rows = db.scalars(
        select(MaintenanceRecord)
        .where(
            MaintenanceRecord.equipment_id == equipment_id,
            MaintenanceRecord.family_id == actor.family_id,
        )
        .order_by(
            MaintenanceRecord.performed_on.desc(),
            MaintenanceRecord.created_at.desc(),
            MaintenanceRecord.id,
        )
    )
    return [_record_out(row) for row in rows]


def _request_hash(equipment_id: uuid.UUID, body: MaintenanceWrite, description: str) -> str:
    return request_hash("equipment_id", equipment_id, body, description)


def add_service(
    db: Session, actor: Member, equipment_id: uuid.UUID, body: MaintenanceWrite
) -> MaintenanceResult:
    row, record, replayed = complete_service(
        db,
        actor,
        equipment_id,
        body,
        target_field="equipment_id",
        load=_get,
        authorize=_authorize,
        today=today_tehran(),
        max_records=_MAX_SERVICES,
        limit_message="تعداد سوابق این وسیله به سقف رسیده است.",
    )
    if not replayed:
        _audit("service", actor, row.id)
    return MaintenanceResult(
        equipment=_one_out(db, actor, row), record=_record_out(record), replayed=replayed
    )
