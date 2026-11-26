"""Signed previews, current permissions and atomic, idempotent confirmed writes."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.errors import AppError
from app.core.feature_policy import require_feature
from app.db.document_scope import bind_member, clear_member
from app.models.assistant_execution import AssistantExecutionReceipt
from app.models.meal import MealEntry
from app.models.shopping import InventoryItem, ShoppingList
from app.schemas.assistant import PrepareActionIn
from app.schemas.data import ShoppingItemWrite, ShoppingListWrite
from app.schemas.meals import MealEntryWrite
from app.schemas.tasks import TaskWrite
from app.services import inventory, meals, shopping, tasks
from app.services.household_context import normalize_title, stock_fingerprint


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      default=str).encode("utf-8")


def _secret():
    if not settings.file_signing_secret:
        raise AppError("AI_SIGNING_UNAVAILABLE", "بررسی امنِ تغییرها فعلاً در دسترس نیست.", 503)
    return settings.file_signing_secret.encode()


def _stock_hash(db, actor, *, lock=False):
    if lock:
        db.scalars(select(InventoryItem).where(InventoryItem.family_id == actor.family_id)
                   .order_by(InventoryItem.id).with_for_update()
                   .execution_options(populate_existing=True)).all()
    rows = [row.model_dump(mode="json") for row in inventory.list_for_family(db, actor)]
    return stock_fingerprint(rows)


def _check_evidence(db, actor, expected):
    if "dish_id" in expected:
        require_feature("meals")
        dish = meals._get_dish(db, actor, uuid.UUID(expected["dish_id"]), lock=True)
        if dish.revision != expected["dish_revision"]:
            raise AppError("AI_CONTEXT_CHANGED",
                           "اطلاعات غذا تغییر کرده است؛ دوباره بررسی کنید.", 409)
    if "stock_hash" in expected:
        require_feature("inventory")
        if _stock_hash(db, actor, lock=True) != expected["stock_hash"]:
            raise AppError("AI_CONTEXT_CHANGED",
                           "موجودی ثبت‌شده تغییر کرده است؛ تغییرها را دوباره بررسی کنید.", 409)


def sign_payload(actor, payload: dict):
    value = {**payload, "family_id": str(actor.family_id), "member_id": str(actor.id),
             "expires": int(time.time()) + 900}
    encoded = base64.urlsafe_b64encode(_bytes(value)).decode().rstrip("=")
    signature = hmac.new(_secret(), b"household-assistant-v2\0" + encoded.encode(),
                         hashlib.sha256).hexdigest()
    return encoded + "." + signature


def read_payload(actor, token: str, kind: str, *, expired=False):
    try:
        encoded, signature = token.rsplit(".", 1)
        expected = hmac.new(_secret(), b"household-assistant-v2\0" + encoded.encode(),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if (payload["family_id"] != str(actor.family_id) or payload["member_id"] != str(actor.id)
                or payload["type"] != kind):
            raise ValueError()
        if not expired and payload["expires"] < time.time():
            raise AppError("AI_REVIEW_EXPIRED",
                           "زمان تأیید گذشته است؛ تغییرها را دوباره بررسی کنید.", 409)
        return payload
    except (ValueError, KeyError, TypeError):
        raise AppError("AI_REVIEW_INVALID",
                       "این پیشنهاد معتبر نیست؛ دوباره بررسی کنید.", 422) from None


def _prepare_values(db, actor, candidate: dict, body: PrepareActionIn):
    kind = candidate["kind"]
    if kind == "shopping_list":
        title = inventory.clean_title(body.title, "نام لیست")
        return {"title": title}, {"title": title}, {}
    if kind == "shopping_item":
        if body.list_id is None or body.qty is None:
            raise AppError("AI_DETAILS_REQUIRED", "لیست مقصد و مقدار خرید را مشخص کنید.", 422)
        parent = shopping._get_list(db, actor, body.list_id)
        item = ShoppingItemWrite(title=candidate["title"], qty=body.qty, unit=body.unit)
        values = shopping._prepare_item(db, actor, item)
        values = {"list_id": str(parent.id), "title": values["title"],
                  "qty": str(values["qty"]), "unit": values["unit"]}
        expected = {**candidate.get("evidence", {}), "list_title": parent.title}
        return values, {**values, "destination_title": parent.title}, expected
    if kind == "task":
        request = TaskWrite(title=candidate["title"], description=candidate.get("description"),
                            due_date=body.due_date, assignee_id=body.assignee_id)
        values = json.loads(json.dumps(tasks.prepare(db, actor, request), default=str))
        return values, dict(values), {}
    if kind == "meal_entry":
        if body.due_date is None or body.meal_type is None:
            raise AppError("AI_DETAILS_REQUIRED", "روز و وعدهٔ غذا را مشخص کنید.", 422)
        dish = meals._get_dish(db, actor, uuid.UUID(candidate["dish_id"]), lock=True)
        occupied = db.scalar(select(MealEntry).where(
            MealEntry.family_id == actor.family_id, MealEntry.date == body.due_date,
            MealEntry.meal_type == body.meal_type,
        ))
        if occupied is not None:
            raise AppError("MEAL_SLOT_OCCUPIED", "برای این وعده قبلاً غذا انتخاب شده است.", 409)
        values = {"dish_id": str(dish.id), "date": body.due_date.isoformat(),
                  "meal_type": body.meal_type}
        return values, {**values, "title": dish.title}, {
            **candidate.get("evidence", {}),
            "dish_revision": dish.revision, "stock_hash": _stock_hash(db, actor),
        }
    raise AppError("AI_ACTION_UNSUPPORTED", "این تغییر را از بخش مربوط برنامه ادامه دهید.", 422)


def prepare(db, actor, body: PrepareActionIn):
    report = read_payload(actor, body.report_token, "report")
    candidate = next((item for item in report["actions"] if item["id"] == body.action_id), None)
    if candidate is None:
        raise AppError("AI_REVIEW_INVALID", "این پیشنهاد معتبر نیست؛ دوباره بررسی کنید.", 422)
    require_feature({"shopping_list": "shopping", "shopping_item": "shopping",
                     "task": "tasks", "meal_entry": "meals"}[candidate["kind"]], write=True)
    # Shopping checkout takes its destination before inventory; use that same
    # order, so freshness checks do not introduce a lock inversion.
    if candidate["kind"] == "shopping_item" and body.list_id is not None:
        shopping._get_list(db, actor, body.list_id)
    _check_evidence(db, actor, candidate.get("evidence", {}))
    values, summary, expected = _prepare_values(db, actor, candidate, body)
    operation_id = str(uuid.uuid5(uuid.UUID(report["report_id"]), candidate["id"]))
    payload = {"type": "review", "operation_id": operation_id, "kind": candidate["kind"],
               "values": values, "expected": expected}
    return {"operation_id": operation_id, "kind": candidate["kind"], "summary": summary,
            "review_token": sign_payload(actor, payload), "expires_in": 900}


def receipt(db, actor, operation_id: uuid.UUID):
    bind_member(db, actor.id)
    try:
        value = db.get(AssistantExecutionReceipt, (actor.family_id, actor.id, operation_id))
        if value is None:
            raise AppError("NOT_FOUND", "نتیجهٔ ثبت‌شده‌ای برای این اقدام وجود ندارد.", 404)
        return {**value.result_json, "replayed": True}
    finally:
        clear_member(db)


def execute(db, actor, token: str):
    payload = read_payload(actor, token, "review", expired=True)
    operation_id = uuid.UUID(payload["operation_id"])
    request_hash = hashlib.sha256(_bytes({key: payload[key] for key in
                                         ("kind", "values", "expected")})).hexdigest()
    bind_member(db, actor.id)
    try:
        lock_key = int.from_bytes(hashlib.sha256(
            f"assistant/{actor.family_id}/{actor.id}/{operation_id}".encode(),
        ).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
        old = db.get(AssistantExecutionReceipt, (actor.family_id, actor.id, operation_id))
        if old:
            if old.request_hash != request_hash:
                raise AppError("AI_REPLAY_CONFLICT", "این اقدام با اطلاعات دیگری ثبت شده است.", 409)
            return {**old.result_json, "replayed": True}
        if payload["expires"] < time.time():
            raise AppError("AI_REVIEW_EXPIRED",
                           "زمان تأیید گذشته است؛ تغییرها را دوباره بررسی کنید.", 409)
        kind, values = payload["kind"], payload["values"]
        require_feature({"shopping_list": "shopping", "shopping_item": "shopping",
                         "task": "tasks", "meal_entry": "meals"}[kind], write=True)
        if kind == "shopping_item":
            shopping._get_list(db, actor, uuid.UUID(values["list_id"]))
        _check_evidence(db, actor, payload["expected"])
        status = "saved"
        if kind == "shopping_list":
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"),
                       {"key": int.from_bytes(hashlib.sha256(
                           f"assistant-list/{actor.family_id}".encode(),
                       ).digest()[:8], "big", signed=True)})
            row = db.scalar(select(ShoppingList).where(ShoppingList.family_id == actor.family_id,
                                                       ShoppingList.title == values["title"]))
            if row is not None:
                status = "existing"
            else:
                row = shopping.create_list_row(db, actor, ShoppingListWrite(**values))
        elif kind == "shopping_item":
            list_id = uuid.UUID(values["list_id"])
            parent = shopping._get_list(db, actor, list_id)
            if parent.title != payload["expected"]["list_title"]:
                raise AppError("AI_CONTEXT_CHANGED",
                               "نام لیست مقصد تغییر کرده است؛ دوباره بررسی کنید.", 409)
            row = next((item for item in shopping._pending_of(db, actor, list_id)
                        if normalize_title(item.title) == normalize_title(values["title"])), None)
            if row is not None:
                status = "existing"
            else:
                row = shopping.add_item_row(db, actor, list_id, ShoppingItemWrite(
                    **{key: value for key, value in values.items() if key != "list_id"},
                ))
        elif kind == "task":
            row = tasks.create_row(db, actor, TaskWrite(**values))
        elif kind == "meal_entry":
            dish = meals._get_dish(db, actor, uuid.UUID(values["dish_id"]), lock=True)
            if dish.revision != payload["expected"]["dish_revision"]:
                raise AppError("AI_CONTEXT_CHANGED",
                               "اطلاعات غذا تغییر کرده است؛ دوباره بررسی کنید.", 409)
            row = meals.create_entry_row(db, actor, MealEntryWrite(**values))
        else:
            raise AppError("AI_ACTION_UNSUPPORTED",
                           "این تغییر را از بخش مربوط برنامه ادامه دهید.", 422)
        db.flush()
        result = {"operation_id": str(operation_id), "kind": kind, "status": status,
                  "entity_id": str(row.id), "replayed": False}
        db.add(AssistantExecutionReceipt(family_id=actor.family_id, member_id=actor.id,
                                         operation_id=operation_id, request_hash=request_hash,
                                         result_json=result))
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise AppError("AI_CONTEXT_CHANGED", "اطلاعات مقصد تغییر کرده است؛ دوباره بررسی کنید.",
                       409) from None
    finally:
        clear_member(db)
