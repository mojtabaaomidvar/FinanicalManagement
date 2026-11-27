"""Versioned, idempotent shopping writes with no offline Finance contract.

The mutation and its receipt commit together. Retrying a timed-out request cannot
repeat an adjustment, and a stale household edit never overwrites server data.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.core.feature_policy import feature_state, require_feature
from app.models.family import Member
from app.models.shopping import InventoryItem, ShoppingItem, ShoppingList
from app.models.shopping_sync import ShoppingSyncReceipt
from app.models.task import Task
from app.schemas.data import InventoryWrite, ShoppingItemWrite
from app.schemas.offline_shopping import (
    OfflineInventoryOut,
    OfflineItemOut,
    OfflineListOut,
    OfflineMutation,
    OfflineMutationResult,
    OfflineSnapshot,
    OfflineTaskNotificationPrefs,
)
from app.schemas.tasks import TaskWrite
from app.services import inventory, inventory_catalog, shopping, tasks
from app.services.clock import utcnow
from app.services.notifications import _clean_lead


def _task_notification_prefs(actor: Member) -> OfflineTaskNotificationPrefs:
    raw = actor.notif_prefs if isinstance(actor.notif_prefs, dict) else {}
    domains = raw.get("domains")
    leads = raw.get("leadDays")
    return OfflineTaskNotificationPrefs(
        enabled=bool(actor.notif_enabled),
        tasks_enabled=bool(domains.get("tasks", True)) if isinstance(domains, dict) else True,
        lead_days=(_clean_lead(leads.get("tasks")) or 0) if isinstance(leads, dict) else 0,
    )


def snapshot(db: Session, actor: Member) -> OfflineSnapshot:
    """Only the explicitly permitted household projection may leave this endpoint."""
    lists = list(
        db.scalars(
            select(ShoppingList)
            .where(ShoppingList.family_id == actor.family_id)
            .order_by(ShoppingList.created_at, ShoppingList.id)
            .execution_options(populate_existing=True)
        )
    )
    items = list(
        db.scalars(
            select(ShoppingItem)
            .where(ShoppingItem.family_id == actor.family_id, ShoppingItem.bought_at.is_(None))
            .order_by(ShoppingItem.checked, ShoppingItem.created_at, ShoppingItem.id)
            .execution_options(populate_existing=True)
        )
    )
    grouped: dict[uuid.UUID, list[OfflineItemOut]] = {row.id: [] for row in lists}
    for row in items:
        bucket = grouped.get(row.list_id)
        if bucket is not None:
            bucket.append(
                OfflineItemOut(
                    id=str(row.id),
                    list_id=str(row.list_id),
                    title=row.title,
                    qty=row.qty,
                    unit=row.unit,
                    checked=row.checked,
                    inventory_item_id=str(row.inventory_item_id) if row.inventory_item_id else None,
                    note=row.note,
                    revision=row.revision,
                    created_at=row.created_at,
                )
            )
    stock = list(
        db.scalars(
            select(InventoryItem)
            .where(InventoryItem.family_id == actor.family_id)
            .execution_options(populate_existing=True)
        )
    )
    stock.sort(key=lambda row: (row.title, str(row.id)))
    result = OfflineSnapshot(
        lists=[
            OfflineListOut(
                id=str(row.id),
                title=row.title,
                revision=row.revision,
                created_at=row.created_at,
                items=grouped[row.id],
            )
            for row in lists
        ],
        inventory=[
            OfflineInventoryOut(
                id=str(row.id),
                title=row.title,
                unit=row.unit,
                quantity=row.quantity,
                catalog_id=row.catalog_id or inventory_catalog.catalog_id_for_title(row.title, db),
                category=row.category,
                note=row.note,
                revision=row.revision,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in stock
        ],
        tasks=tasks.list_for_family(db, actor),
        task_notification_prefs=_task_notification_prefs(actor),
    )
    if feature_state("shopping") == "disabled":
        result.lists = []
    if feature_state("inventory") == "disabled":
        result.inventory = []
    if feature_state("tasks") == "disabled":
        result.tasks = []
        result.task_notification_prefs.tasks_enabled = False
    return result


def _conflict(message: str = "این مورد روی سرور تغییر کرده است؛ تغییر آفلاین اعمال نشد."):
    return AppError("SYNC_CONFLICT", message, 409)


def _get_locked(db: Session, actor: Member, model, entity_id: uuid.UUID):
    row = db.scalar(
        select(model)
        .where(model.id == entity_id, model.family_id == actor.family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        # The same response for removed records and foreign tenant IDs avoids IDOR.
        raise AppError("NOT_FOUND", "این مورد دیگر در دسترس نیست؛ تغییر آفلاین اعمال نشد.", 404)
    return row


def _get_target(db: Session, actor: Member, req: OfflineMutation):
    model = {
        "list": ShoppingList,
        "item": ShoppingItem,
        "inventory": InventoryItem,
        "task": Task,
    }[req.kind.split(".")[0]]
    row = (
        shopping._get_item(db, actor, req.entity_id)
        if model is ShoppingItem
        else _get_locked(db, actor, model, req.entity_id)
    )
    if isinstance(row, Task):
        tasks.assert_permission(actor, row, req.kind.split(".")[1])
    if row.revision != req.base_revision:
        raise _conflict()
    if isinstance(row, ShoppingItem) and row.bought_at is not None:
        raise _conflict("این قلم قبلاً خریده شده است؛ تغییر آفلاین اعمال نشد.")
    return row


def _prepare_item(db: Session, actor: Member, data: dict, price=None) -> dict:
    values = dict(data)
    values.pop("list_id", None)
    if values.get("inventory_item_id") is not None:
        values["inventory_item_id"] = str(values["inventory_item_id"])
    # The caller never accepts a price. Existing prices remain server-only and intact.
    return shopping._prepare_item(db, actor, ShoppingItemWrite(**values, price=price))


def _create(db: Session, actor: Member, req: OfflineMutation, data: dict):
    entity_type = req.kind.split(".")[0]
    if entity_type == "task":
        return tasks.create_row(db, actor, TaskWrite(**data), req.entity_id)
    if entity_type == "list":
        count = len(
            list(
                db.scalars(select(ShoppingList.id).where(ShoppingList.family_id == actor.family_id))
            )
        )
        if count >= shopping._MAX_LISTS:
            raise AppError("LIMIT_REACHED", "تعداد لیست‌ها به سقف رسیده است.", 409)
        row = ShoppingList(
            id=req.entity_id,
            family_id=actor.family_id,
            created_by=actor.id,
            title=inventory.clean_title(data["title"], "نام لیست"),
        )
    elif entity_type == "item":
        parent = _get_locked(db, actor, ShoppingList, data["list_id"])
        values = _prepare_item(db, actor, data)
        shopping._assert_item_unique(db, actor, parent.id, values["title"])
        if len(shopping._pending_of(db, actor, parent.id)) >= shopping._MAX_ITEMS:
            raise AppError("LIMIT_REACHED", "تعداد اقلام این لیست به سقف رسیده است.", 409)
        row = ShoppingItem(
            id=req.entity_id,
            family_id=actor.family_id,
            created_by=actor.id,
            list_id=parent.id,
            **values,
        )
    else:
        values = inventory._prepare(InventoryWrite(**data), db=db)
        inventory._assert_unique(db, actor.family_id, values["title"])
        row = InventoryItem(
            id=req.entity_id, family_id=actor.family_id, created_by=actor.id, **values
        )
        inventory_catalog.propose(db, title=row.title, category=row.category, unit=row.unit)
    db.add(row)
    return row


def _update(db: Session, actor: Member, req: OfflineMutation, data: dict):
    row = _get_target(db, actor, req)
    entity_type, action = req.kind.split(".")
    if entity_type == "task":
        return tasks.change_row(db, actor, row, action, data)
    if action == "delete":
        db.delete(row)
        return None
    if entity_type == "list":
        row.title = inventory.clean_title(data["title"], "نام لیست")
    elif entity_type == "item":
        if action == "check":
            row.checked = data["checked"]
        else:
            values = _prepare_item(db, actor, data, price=row.price)
            shopping._assert_item_unique(db, actor, row.list_id, values["title"], exclude=row.id)
            for key, value in values.items():
                setattr(row, key, value)
    elif action == "adjust":
        delta = data["delta"].quantize(Decimal("0.01"))
        row.quantity = inventory.clean_number(max(Decimal(0), row.quantity + delta), "موجودی")
        row.updated_at = utcnow()
    else:
        values = inventory._prepare(InventoryWrite(**data), existing_category=row.category, db=db)
        inventory._assert_unique(db, actor.family_id, values["title"], exclude=row.id)
        for key, value in values.items():
            setattr(row, key, value)
        row.updated_at = utcnow()
    if entity_type == "inventory" and action == "update":
        inventory_catalog.propose(db, title=row.title, category=row.category, unit=row.unit)
    # Even a no-op has one acknowledged revision step, so dependent queued
    # writes can predict their own revisions without rebasing external changes.
    field = "checked" if action == "check" else "quantity" if action == "adjust" else "title"
    flag_modified(row, field)
    return row


def _result(
    db: Session, actor: Member, receipt: ShoppingSyncReceipt, replayed: bool
) -> OfflineMutationResult:
    return OfflineMutationResult(
        operation_id=str(receipt.operation_id),
        replayed=replayed,
        entity_type=receipt.entity_type,
        entity_id=str(receipt.entity_id),
        revision=receipt.revision,
        snapshot=snapshot(db, actor),
    )


def mutate(db: Session, actor: Member, req: OfflineMutation) -> OfflineMutationResult:
    encoded = json.dumps(req.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    request_hash = hashlib.sha256(encoded.encode()).hexdigest()
    # Same operation arriving from a tab and Service Worker is serialized across
    # processes. Its row change and receipt remain a single database transaction.
    shopping._lock_operation(db, actor, req.operation_id)
    receipt = db.get(ShoppingSyncReceipt, (actor.family_id, actor.id, req.operation_id))
    if receipt is not None:
        if receipt.request_hash != request_hash:
            raise AppError(
                "OPERATION_REUSED", "شناسهٔ این تغییر قبلاً با اطلاعات دیگری استفاده شده است.", 409
            )
        if receipt.entity_type == "task" and req.kind != "task.create":
            current = db.scalar(
                select(Task)
                .where(
                    Task.id == req.entity_id,
                    Task.family_id == actor.family_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            # A deleted task's receipt still acknowledges the already committed
            # operation. Existing tasks must honor current role/assignment even
            # when the request previously succeeded but its response was lost.
            if current is not None:
                tasks.assert_permission(actor, current, req.kind.split(".")[1])
        return _result(db, actor, receipt, True)

    try:
        module = {"list": "shopping", "item": "shopping", "inventory": "inventory", "task": "tasks"}[
            req.kind.partition(".")[0]
        ]
        require_feature(module, write=True)
        data = req.data()
        row = (
            _create(db, actor, req, data)
            if req.kind.endswith(".create")
            else _update(db, actor, req, data)
        )
        db.flush()
        if row is not None:
            db.refresh(row)
        receipt = ShoppingSyncReceipt(
            family_id=actor.family_id,
            member_id=actor.id,
            operation_id=req.operation_id,
            request_hash=request_hash,
            entity_type=req.kind.split(".")[0],
            entity_id=req.entity_id,
            revision=row.revision if row is not None else None,
        )
        db.add(receipt)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "این تغییر با اطلاعات فعلی سرور سازگار نیست؛ دوباره بررسی‌اش کنید."
        ) from None
    return _result(db, actor, receipt, False)
