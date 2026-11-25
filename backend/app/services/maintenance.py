"""Shared locking, provenance and atomic completion for equipment and vehicles."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import date
from typing import TypeVar

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.equipment import Equipment, MaintenanceRecord
from app.models.family import Member
from app.models.vehicle import Vehicle
from app.schemas.equipment import MaintenanceWrite
from app.schemas.vehicles import VehicleServiceWrite
from app.services import transactions
from app.services.common import is_admin
from app.services.inventory import clean_opt_text

Target = TypeVar("Target", Equipment, Vehicle)


def get_target(
    db: Session,
    actor: Member,
    model: type[Target],
    target_id: uuid.UUID,
    missing_message: str,
    *,
    lock: bool = False,
) -> Target:
    query = select(model).where(model.id == target_id, model.family_id == actor.family_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = db.scalar(query)
    if row is None:
        raise AppError("NOT_FOUND", missing_message, 404)
    return row


def authorize_target(
    actor: Member,
    row: Equipment | Vehicle,
    forbidden_code: str,
    forbidden_message: str,
    conflict_message: str,
    revision: int | None = None,
) -> None:
    if not (is_admin(actor) or row.created_by == actor.id):
        raise AppError(forbidden_code, forbidden_message, 403)
    if revision is not None and row.revision != revision:
        raise AppError("SYNC_CONFLICT", conflict_message, 409)


def request_hash(
    target_field: str, target_id: uuid.UUID, body: MaintenanceWrite, description: str
) -> str:
    # Keep the equipment hash byte-for-byte compatible with already stored operations.
    values = body.model_dump(mode="json", exclude={"operation_id"})
    values.update({target_field: str(target_id), "description": description})
    return hashlib.sha256(
        json.dumps(values, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def existing_operation(
    db: Session, actor: Member, operation_id: uuid.UUID
) -> MaintenanceRecord | None:
    return db.scalar(
        select(MaintenanceRecord).where(
            MaintenanceRecord.family_id == actor.family_id,
            MaintenanceRecord.operation_id == operation_id,
        )
    )


def validate_replay(
    actor: Member,
    row: Equipment | Vehicle,
    record: MaintenanceRecord,
    target_field: str,
    fingerprint: str,
) -> None:
    if record.created_by != actor.id or getattr(record, target_field) != row.id:
        raise AppError("OPERATION_CONFLICT", "این شناسهٔ عملیات قابل استفاده نیست.", 409)
    if record.request_hash != fingerprint:
        raise AppError("OPERATION_CONFLICT", "اطلاعات عملیات قبلی تغییر کرده است.", 409)


def complete_service(
    db: Session,
    actor: Member,
    target_id: uuid.UUID,
    body: MaintenanceWrite,
    *,
    target_field: str,
    load: Callable[..., Target],
    authorize: Callable[..., None],
    today: date,
    max_records: int,
    limit_message: str,
) -> tuple[Target, MaintenanceRecord, bool]:
    from app.db.financial_lock import lock_financial_family
    lock_financial_family(db, actor.family_id)
    description = clean_opt_text(body.description, 1000, "شرح سرویس")
    if not description:
        raise AppError("INVALID_INPUT", "شرح سرویس را بنویسید.", 422)
    if body.performed_on > today:
        raise AppError("INVALID_INPUT", "تاریخ انجام سرویس نمی‌تواند بعد از امروز باشد.", 422)
    row = load(db, actor, target_id, lock=True)
    authorize(actor, row)
    fingerprint = request_hash(target_field, target_id, body, description)
    existing = existing_operation(db, actor, body.operation_id)
    # A successful first attempt advances the revision and odometer. Retries still replay.
    if existing is not None:
        validate_replay(actor, row, existing, target_field, fingerprint)
        return row, existing, True
    authorize(actor, row, body.base_revision)
    vehicle_service = isinstance(body, VehicleServiceWrite)
    if vehicle_service and body.performed_odometer < row.odometer:
        raise AppError("INVALID_INPUT", "کیلومتر انجام سرویس از کیلومتر فعلی کمتر است.", 422)
    count = db.scalar(
        select(func.count())
        .select_from(MaintenanceRecord)
        .where(
            getattr(MaintenanceRecord, target_field) == row.id,
            MaintenanceRecord.family_id == actor.family_id,
        )
    )
    if count >= max_records:
        raise AppError("LIMIT_REACHED", limit_message, 409)
    record = MaintenanceRecord(
        family_id=actor.family_id,
        created_by=actor.id,
        operation_id=body.operation_id,
        request_hash=fingerprint,
        performed_on=body.performed_on,
        description=description,
        next_due_date=body.next_due_date,
        **{target_field: row.id},
    )
    try:
        row.service_due_date = body.next_due_date
        flag_modified(row, "service_due_date")
        if vehicle_service:
            row.odometer = body.performed_odometer
            row.service_due_odometer = body.next_due_odometer
            record.performed_odometer = body.performed_odometer
            record.next_due_odometer = body.next_due_odometer
            record.had_cost = body.cost_amount is not None
        db.add(record)
        if vehicle_service and body.cost_amount is not None:
            expense = transactions.create_vehicle_service_uncommitted(
                db,
                actor,
                body.cost_amount,
                body.performed_on,
                body.account_id,
                description,
            )
            record.transaction_id = expense.id
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) != (
            "uq_maintenance_family_operation"
        ):
            raise
        row = load(db, actor, target_id, lock=True)
        authorize(actor, row)
        existing = existing_operation(db, actor, body.operation_id)
        if existing is None:
            raise AppError(
                "SYNC_CONFLICT", "عملیات تغییر کرده است؛ دوباره تلاش کنید.", 409
            ) from None
        validate_replay(actor, row, existing, target_field, fingerprint)
        return row, existing, True
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    db.refresh(record)
    return row, record, False
