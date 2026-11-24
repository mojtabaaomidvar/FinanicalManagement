"""Authorized read projections and deterministic household facts; never business writes."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import AppError
from app.db.document_scope import bind_member, clear_member
from app.schemas.data import EventOut
from app.services import (
    accounts,
    activities,
    bills,
    categories,
    children,
    documents,
    equipment,
    events,
    goals,
    holdings,
    inventory,
    market,
    meals,
    pets,
    tasks,
    transactions,
    vehicles,
)
from app.services.sms_assistant import _mask_text
from app.services.sms_parser import normalize_sms

MAX_ROWS = 40
MAX_CONTEXT_BYTES = 90000


def normalize_title(value: str) -> str:
    value = " ".join(normalize_sms(value).split())
    return "نان" if value == "نون" else value


def ingredient_status(ingredient: dict, stock: list[dict]) -> dict:
    matches = [row for row in stock if normalize_title(row["title"])
               == normalize_title(ingredient["title"])]
    result = {**ingredient, "status": "unknown", "shortage": None, "inventory_id": None}
    if len(matches) != 1:
        return result
    row = matches[0]
    result["inventory_id"] = row.get("id")
    if ingredient.get("qty") is None:
        # A library ingredient names a requirement, not a known recipe amount.
        return result
    units = {"گرم": ("mass", Decimal(1)), "کیلوگرم": ("mass", Decimal(1000)),
             "کیلو": ("mass", Decimal(1000)), "میلی لیتر": ("volume", Decimal(1)),
             "میلی‌لیتر": ("volume", Decimal(1)), "لیتر": ("volume", Decimal(1000))}
    have, need = Decimal(str(row["quantity"])), Decimal(str(ingredient["qty"]))
    left, right = row.get("unit"), ingredient.get("unit")
    if left != right:
        if left not in units or right not in units or units[left][0] != units[right][0]:
            return result
        have = have * units[left][1] / units[right][1]
    elif left is None:
        # Unknown units are not proof of a compatible recipe quantity.
        return result
    result.update(status="available" if have >= need else "missing",
                  shortage=str(max(Decimal(0), need - have)))
    return result


def _data(value):
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


def _fields(row, names: str) -> dict:
    if not isinstance(row, dict):
        return {name: getattr(row, name, None) for name in names.split()}
    return {name: row.get(name) for name in names.split()}


def _read(db, actor, section: str, day: date) -> list[dict]:
    if section == "inventory":
        return [_data(row) for row in inventory.list_for_family(db, actor)]
    if section == "shopping":
        return [_data(row) for row in shopping_lists(db, actor)]
    if section == "meals":
        start = day - timedelta(days=(day.weekday() - 5) % 7)
        entries = meals.plan(db, actor, start).model_dump(mode="json")["entries"]
        rows = [_data(row) for row in meals.list_dishes(db, actor)]
        return [{**row, "planned": [entry for entry in entries if entry["dish_id"] == row["id"]]}
                for row in rows]
    if section == "tasks":
        return [_data(row) for row in tasks.list_for_family(db, actor)]
    if section == "events":
        return [EventOut.of(row).model_dump(mode="json")
                for row in events.list_for_family(db, actor.family_id)]
    if section == "equipment":
        return [{**_data(row), "services": [_data(service) for service in
                 equipment.list_services(db, actor, row.id)]}
                for row in equipment.list_equipment(db, actor)[:MAX_ROWS]]
    if section == "vehicles":
        return [{**_data(row), "services": [_data(service) for service in
                 vehicles.list_services(db, actor, row.id)] if row.can_view_history else []}
                for row in vehicles.list_vehicles(db, actor).vehicles[:MAX_ROWS]]
    if section == "bills":
        return [_data(row) for row in bills.list_for_family(db, actor)]
    if section == "finance":
        # Deliberately exclude another member's account details from the provider.
        own = {row.id for row in accounts.list_for_family(db, actor.family_id)
               if row.member_id == actor.id}
        rows = [_fields(row, "id title initial_balance kind") for row in
                accounts.list_for_family(db, actor.family_id) if row.id in own]
        for row, _photos in transactions.list_for_family(db, actor.family_id, actor):
            if row.account_id in own or row.member_id == actor.id and row.account_id is None:
                rows.append(_fields(row, "id type amount category date note"))
        rows += [_fields(row, "id category amount")
                 for row in categories.list_category_budgets(db, actor.family_id)]
        return rows
    if section == "goals":
        return [_data(row) for row in goals.list_goals(db, actor).goals]
    if section == "activities":
        return [_data(row) for row in activities.list_activities(db, actor).activities]
    if section == "children":
        return [_data(children.get(db, actor, row.id))
                for row in children.list_children(db, actor).children[:MAX_ROWS]]
    if section == "pets":
        return [_data(pets.get(db, actor, row.id))
                for row in pets.list_pets(db, actor).pets[:MAX_ROWS]]
    if section == "documents":
        documents.require_adult(actor)
        return [_data(row) for row in documents.list_for_member(db, actor)]
    if section == "holdings":
        return [_fields(row, "id name kind quantity unit symbol")
                for row in holdings.list_for_family(db, actor.family_id)]
    if section == "market":
        return market.cached_household_prices()
    raise ValueError("Unknown context adapter")


def shopping_lists(db, actor):
    from app.services import shopping
    return shopping.list_for_family(db, actor)


FIELDS = {
    "inventory": "id title quantity unit category revision",
    "shopping": "id title items",
    "meals": "id title ingredients planned revision",
    "tasks": "id title description due_date completed assignee_id revision",
    "events": "id title date kind",
    "equipment": "id title brand model warranty_until service_due_date services revision",
    "vehicles": "id title brand model odometer insurance_until inspection_until "
                "service_due_date service_due_odometer services revision",
    "bills": "id title kind amount due_date state paid_at",
    "finance": "id title type amount initial_balance kind category date note",
    "goals": "id title note kind target_date status",
    "activities": "id title date location status participant_ids",
    "children": "child tasks activities birthday",
    "pets": "pet care_tasks",
    "documents": "id title category expiry_date revision",
    "holdings": "id name kind quantity unit symbol",
    "market": "symbol name price unit cached_at stale",
}
NESTED_FIELDS = {
    "items": "id title qty unit checked revision",
    "ingredients": "title qty unit",
    "planned": "id date meal_type dish_id revision",
    "services": "id performed_on description next_due_date performed_odometer "
                "next_due_odometer cost_amount cost_status",
    "tasks": "id title due_date completed", "activities": "id title date status",
    "care_tasks": "id title due_date completed",
    "child": "id name age_years status", "pet": "id name species birth_date",
    "birthday": "id title date", "participants": "id name",
}


def _project_nested(row: dict) -> dict:
    for key, names in NESTED_FIELDS.items():
        value = row.get(key)
        if isinstance(value, list):
            row[key] = [_fields(item, names) for item in value[:MAX_ROWS]]
        elif isinstance(value, dict):
            row[key] = _fields(value, names)
    # Monetary storage in these existing app contracts is toman. Keep the
    # canonical calculation unit explicit for inference, separate from labels.
    if any(row.get(key) is not None for key in ("amount", "initial_balance", "cost_amount")):
        row["money_unit"] = "toman"
    for service in row.get("services") or []:
        if service.get("cost_amount") is not None:
            service["money_unit"] = "toman"
    for key, value in row.items():
        if isinstance(value, list):
            row[key] = value[:MAX_ROWS]
    return row


def _sanitize(value):
    if isinstance(value, str):
        # Redact before clipping, so a boundary cannot split a sensitive number
        # into an unrecognizable but still leaked prefix.
        return sanitize_text(value)[:2000]
    if isinstance(value, dict):
        return {key: _sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    return value


def sanitize_text(value: str) -> str:
    """Context-only redaction; never changes the existing SMS parsing contract."""
    masked = _mask_text(value, [])[0]
    masked = re.sub(r"(?i)\b(?:sk|ghp|github_pat)-?[a-z0-9_-]{20,}\b", "[secret]", masked)
    return re.sub(
        r"(?i)((?:رمز(?:\s+(?:عبور|پویا|یکبارمصرف))?|password|token|api[_ -]?key|secret)"
        r"\s*[:=：]?\s*)[^\s،,;؛]+", r"\1[secret]", masked,
    )


def stock_fingerprint(rows: list[dict]) -> str:
    evidence = [_fields(_sanitize(row), "id title quantity unit revision") for row in rows]
    return hashlib.sha256(json.dumps(sorted(evidence, key=lambda row: row["id"]),
                                     sort_keys=True, ensure_ascii=False,
                                     default=str).encode()).hexdigest()


def read_context(db, actor, sections: list[str], terms: list[str], day: date) -> list[dict]:
    result = []
    bind_member(db, actor.id)
    try:
        for section in dict.fromkeys(sections):
            if section not in FIELDS:
                continue
            try:
                # Failed adapters cannot poison the remaining reads/transaction.
                with db.begin_nested():
                    rows = _read(db, actor, section, day)
                selected = []
                nested_truncated = False
                for row in rows:
                    projected = _fields(row, FIELDS[section])
                    nested_truncated |= any(isinstance(value, list) and len(value) > MAX_ROWS
                                            for value in projected.values())
                    nested_truncated |= _has_long_text(projected)
                    projected = _project_nested(projected)
                    if section in {"tasks", "events", "bills", "finance", "activities"}:
                        raw_day = projected.get("date") or projected.get("due_date")
                        if raw_day:
                            try:
                                parsed = date.fromisoformat(str(raw_day)[:10])
                                if abs((parsed - day).days) > 31:
                                    continue
                            except ValueError:
                                continue
                    if terms and section not in {"inventory", "shopping", "meals", "finance"}:
                        text = normalize_title(json.dumps(
                            projected, ensure_ascii=False, default=str,
                        ))
                        if not any(normalize_title(term) in text for term in terms):
                            continue
                    selected.append(projected)
                projected = _sanitize(selected[:MAX_ROWS])
                bounded = json.dumps(projected, ensure_ascii=False, default=str)
                truncated = len(selected) > MAX_ROWS or nested_truncated
                # Detail reads above are capped; the parent coverage must say so too.
                truncated |= section in {"equipment", "vehicles", "children", "pets"} \
                    and len(rows) == MAX_ROWS
                if len(bounded.encode("utf-8")) > MAX_CONTEXT_BYTES // max(1, len(sections)):
                    projected = []
                    truncated = True
                result.append({"section": section,
                               "status": "limited" if truncated else "ok" if selected else
                               "unavailable" if section == "market" else "empty",
                               "rows": json.loads(json.dumps(projected, default=str)),
                               "reference_date": day.isoformat(), "window_days": 31})
            except AppError as error:
                result.append({"section": section,
                               "status": "forbidden" if error.http_status == 403 else "unavailable",
                               "rows": [], "reference_date": day.isoformat(), "window_days": 31})
            except (ValueError, TypeError, AttributeError, SQLAlchemyError):
                result.append({"section": section, "status": "unavailable", "rows": [],
                               "reference_date": day.isoformat(), "window_days": 31})
    finally:
        clear_member(db)
    return result


def _has_long_text(value):
    if isinstance(value, str):
        return len(value) > 2000
    if isinstance(value, dict):
        return any(_has_long_text(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_long_text(item) for item in value)
    return False


def build_facts(context: list[dict], terms: list[str], *, declared_missing=False) -> list[dict]:
    facts = []
    by_section = {item["section"]: item for item in context}
    stock_section = by_section.get("inventory", {})
    stock = stock_section.get("rows", [])
    for term in terms:
        matches = [row for row in stock if normalize_title(row["title"]) == normalize_title(term)]
        status = "unknown" if len(matches) != 1 or stock_section.get("status") != "ok" else (
            "missing" if Decimal(matches[0]["quantity"]) == 0 else "available")
        facts.append({"id": f"stock-{len(facts)}", "kind": "stock", "title": term,
                      "status": status, "conflicts_with_request": declared_missing
                      and status == "available",
                      "rows": matches, "section": "inventory"})
    for dish in by_section.get("meals", {}).get("rows", []):
        ingredients = [ingredient_status(item, stock) for item in dish.get("ingredients") or []]
        # Truncated/missing stock can never prove availability.
        if (stock_section.get("status") not in {"ok", "empty"}
                or by_section.get("meals", {}).get("status") not in {"ok", "empty"}):
            for ingredient in ingredients:
                ingredient.update(status="unknown", shortage=None)
        status = "unknown" if not ingredients or any(item["status"] == "unknown"
                                                    for item in ingredients) else (
            "missing" if any(item["status"] == "missing" for item in ingredients) else "available")
        facts.append({"id": f"dish-{len(facts)}", "kind": "dish", "title": dish["title"],
                      "dish_id": dish["id"], "status": status, "ingredients": ingredients,
                      "planned": dish.get("planned", []), "section": "meals"})
    for item in context:
        if item["section"] in {"inventory", "meals"}:
            continue
        facts.append({"id": f"section-{len(facts)}", "kind": "section",
                      "section": item["section"], "status": item["status"], "rows": item["rows"]})
    return facts[:80]
