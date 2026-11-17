"""Family vehicles with protected projections and Finance-owned service costs."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.document import HouseholdDocument
from app.models.equipment import MaintenanceRecord
from app.models.family import Family, Member
from app.models.task import Task
from app.models.transaction import Transaction
from app.models.vehicle import Vehicle
from app.schemas.vehicles import (
    VehicleListOut,
    VehicleOut,
    VehicleServiceOut,
    VehicleServiceResult,
    VehicleServiceWrite,
    VehicleUpdate,
    VehicleWrite,
)
from app.services.common import is_admin
from app.services.inventory import clean_opt_text, clean_title
from app.services.maintenance import authorize_target, complete_service, get_target
from app.services.member_age import document_age_restricted, today_tehran

logger = logging.getLogger(__name__)
_MAX_VEHICLES = 50
_MAX_SERVICES = 500


def _audit(action: str, actor: Member, vehicle_id: object) -> None:
    logger.info("vehicles action=%s actor=%s vehicle=%s", action, actor.id, vehicle_id)


def _adult(actor: Member) -> bool:
    return (
        actor.status == "active"
        and actor.membership_state == "active"
        and not document_age_restricted(actor)
    )


def _require_adult(actor: Member) -> None:
    if not _adult(actor):
        raise AppError(
            "VEHICLE_FORBIDDEN", "مدیریت خودرو و سابقهٔ سرویس برای این حساب مجاز نیست.", 403
        )


def _allowed(actor: Member, row: Vehicle) -> bool:
    return _adult(actor) and (is_admin(actor) or row.created_by == actor.id)


def _authorize(actor: Member, row: Vehicle, revision: int | None = None) -> None:
    _require_adult(actor)
    authorize_target(
        actor,
        row,
        "VEHICLE_FORBIDDEN",
        "اجازهٔ تغییر این خودرو یا ثبت سرویس را ندارید.",
        "این خودرو تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.",
        revision,
    )


def _get(db: Session, actor: Member, vehicle_id: uuid.UUID, *, lock: bool = False) -> Vehicle:
    return get_target(db, actor, Vehicle, vehicle_id, "خودرو یافت نشد.", lock=lock)


def _visible_document_ids(db: Session, actor: Member, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    if not ids or not _adult(actor):
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


def _out(row: Vehicle, actor: Member, document_ids: set[uuid.UUID]) -> VehicleOut:
    adult = _adult(actor)
    return VehicleOut(
        id=str(row.id),
        title=row.title,
        brand=row.brand,
        model=row.model,
        plate=row.plate if adult else None,
        purchase_date=row.purchase_date,
        odometer=row.odometer,
        insurance_until=row.insurance_until if adult else None,
        inspection_until=row.inspection_until if adult else None,
        document_id=str(row.document_id) if row.document_id in document_ids else None,
        service_task_id=str(row.service_task_id) if row.service_task_id else None,
        service_due_date=row.service_due_date,
        service_due_odometer=row.service_due_odometer,
        service_reminder_enabled=row.service_reminder_enabled,
        created_by=str(row.created_by) if row.created_by else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=_allowed(actor, row),
        can_delete=_allowed(actor, row),
        can_view_history=adult,
    )


def _one_out(db: Session, actor: Member, row: Vehicle) -> VehicleOut:
    ids = {row.document_id} if row.document_id else set()
    return _out(row, actor, _visible_document_ids(db, actor, ids))


def _record_out(row: MaintenanceRecord, expense: Transaction | None) -> VehicleServiceOut:
    return VehicleServiceOut(
        id=str(row.id),
        vehicle_id=str(row.vehicle_id),
        performed_on=row.performed_on,
        description=row.description,
        performed_odometer=row.performed_odometer,
        next_due_date=row.next_due_date,
        next_due_odometer=row.next_due_odometer,
        transaction_id=str(expense.id) if expense else None,
        cost_amount=expense.amount if expense else None,
        cost_status="recorded" if expense else ("unavailable" if row.had_cost else "none"),
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
    )


def _values(db: Session, actor: Member, body: VehicleWrite) -> dict:
    values = body.model_dump(exclude={"base_revision"})
    values["title"] = clean_title(body.title, "نام خودرو")
    values["brand"] = clean_opt_text(body.brand, 80, "برند")
    values["model"] = clean_opt_text(body.model, 80, "مدل")
    values["plate"] = clean_opt_text(body.plate, 30, "پلاک")
    if body.purchase_date and body.purchase_date > today_tehran():
        raise AppError("INVALID_INPUT", "تاریخ خرید نمی‌تواند بعد از امروز باشد.", 422)
    if body.document_id and body.document_id not in _visible_document_ids(
        db, actor, {body.document_id}
    ):
        raise AppError("NOT_FOUND", "سند مشترک و مجاز یافت نشد.", 404)
    if (
        body.service_task_id
        and db.scalar(
            select(Task.id).where(
                Task.id == body.service_task_id,
                Task.family_id == actor.family_id,
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
            "fk_vehicle_document_family",
            "fk_vehicle_task_family",
        }:
            raise AppError(
                "SYNC_CONFLICT", "سند یا کار مرتبط تغییر کرده است؛ دوباره انتخاب کنید.", 409
            ) from None
        raise


def list_vehicles(db: Session, actor: Member) -> VehicleListOut:
    rows = list(
        db.scalars(
            select(Vehicle)
            .where(Vehicle.family_id == actor.family_id)
            .order_by(Vehicle.title, Vehicle.created_at, Vehicle.id)
        )
    )
    document_ids = _visible_document_ids(
        db, actor, {row.document_id for row in rows if row.document_id}
    )
    return VehicleListOut(
        vehicles=[_out(row, actor, document_ids) for row in rows], can_create=_adult(actor)
    )


def create(db: Session, actor: Member, body: VehicleWrite) -> VehicleOut:
    _require_adult(actor)
    values = _values(db, actor, body)
    db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    count = db.scalar(
        select(func.count()).select_from(Vehicle).where(Vehicle.family_id == actor.family_id)
    )
    if count >= _MAX_VEHICLES:
        raise AppError("LIMIT_REACHED", "تعداد خودروهای خانواده به سقف رسیده است.", 409)
    row = Vehicle(family_id=actor.family_id, created_by=actor.id, **values)
    db.add(row)
    _commit_links(db)
    db.refresh(row)
    _audit("create", actor, row.id)
    return _one_out(db, actor, row)


def update(db: Session, actor: Member, vehicle_id: uuid.UUID, body: VehicleUpdate) -> VehicleOut:
    row = _get(db, actor, vehicle_id, lock=True)
    _authorize(actor, row, body.base_revision)
    if body.odometer < row.odometer:
        raise AppError("INVALID_INPUT", "کیلومتر فعلی خودرو نمی‌تواند کاهش یابد.", 422)
    for field, value in _values(db, actor, body).items():
        setattr(row, field, value)
    flag_modified(row, "title")
    _commit_links(db)
    db.refresh(row)
    _audit("update", actor, row.id)
    return _one_out(db, actor, row)


def remove(db: Session, actor: Member, vehicle_id: uuid.UUID, revision: int) -> None:
    row = _get(db, actor, vehicle_id, lock=True)
    _authorize(actor, row, revision)
    db.delete(row)
    db.commit()
    _audit("delete", actor, vehicle_id)


def list_services(db: Session, actor: Member, vehicle_id: uuid.UUID) -> list[VehicleServiceOut]:
    _require_adult(actor)
    _get(db, actor, vehicle_id)
    rows = db.execute(
        select(MaintenanceRecord, Transaction)
        .outerjoin(
            Transaction,
            (Transaction.id == MaintenanceRecord.transaction_id)
            & (Transaction.family_id == MaintenanceRecord.family_id),
        )
        .where(
            MaintenanceRecord.vehicle_id == vehicle_id,
            MaintenanceRecord.family_id == actor.family_id,
        )
        .order_by(
            MaintenanceRecord.performed_on.desc(),
            MaintenanceRecord.created_at.desc(),
            MaintenanceRecord.id,
        )
    )
    return [_record_out(record, expense) for record, expense in rows]


def add_service(
    db: Session, actor: Member, vehicle_id: uuid.UUID, body: VehicleServiceWrite
) -> VehicleServiceResult:
    _require_adult(actor)
    row, record, replayed = complete_service(
        db,
        actor,
        vehicle_id,
        body,
        target_field="vehicle_id",
        load=_get,
        authorize=_authorize,
        today=today_tehran(),
        max_records=_MAX_SERVICES,
        limit_message="تعداد سوابق این خودرو به سقف رسیده است.",
    )
    expense = (
        db.scalar(
            select(Transaction).where(
                Transaction.id == record.transaction_id,
                Transaction.family_id == actor.family_id,
            )
        )
        if record.transaction_id
        else None
    )
    if not replayed:
        _audit("service", actor, row.id)
    return VehicleServiceResult(
        vehicle=_one_out(db, actor, row), record=_record_out(record, expense), replayed=replayed
    )
