"""Tenant-bound meal planning with creator/admin permission and revision checks."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.core.feature_policy import require_feature
from app.models.family import Family, Member
from app.models.meal import Dish, MealEntry
from app.models.shopping import InventoryItem
from app.models.shopping_sync import ShoppingSyncReceipt
from app.schemas.meals import (
    DishOut,
    DishWrite,
    Ingredient,
    IngredientCheck,
    MealEntryOut,
    MealEntryUpdate,
    MealEntryWrite,
    MealPlanOut,
    MealSelectionOut,
    MealSelectionWrite,
    calendar_day,
)
from app.services import inventory_catalog, shopping
from app.services.common import is_admin
from app.services.inventory import clean_number, clean_opt_text, clean_title

_MAX_DISHES = 200
_MEAL_ORDER = {"breakfast": 0, "lunch": 1, "dinner": 2, "snack": 3}


def _allowed(actor: Member, row: Dish | MealEntry) -> bool:
    return is_admin(actor) or row.created_by == actor.id


def _authorize(actor: Member, row: Dish | MealEntry, revision: int) -> None:
    if not _allowed(actor, row):
        raise AppError("MEAL_FORBIDDEN", "اجازهٔ تغییر این برنامه یا غذا را ندارید.", 403)
    if row.revision != revision:
        raise AppError("SYNC_CONFLICT", "این مورد تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409)


def _referenced(db: Session, actor: Member, dish_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(MealEntry.id)
            .where(
                MealEntry.family_id == actor.family_id,
                MealEntry.dish_id == dish_id,
            )
            .limit(1)
        )
        is not None
    )


def _dish_out(row: Dish, actor: Member, referenced: bool) -> DishOut:
    return DishOut(
        id=str(row.id),
        title=row.title,
        ingredients=row.ingredients,
        created_by=str(row.created_by) if row.created_by else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=_allowed(actor, row),
        can_delete=_allowed(actor, row) and not referenced,
    )


def _entry_out(row: MealEntry, actor: Member) -> MealEntryOut:
    return MealEntryOut(
        id=str(row.id),
        date=row.date,
        meal_type=row.meal_type,
        dish_id=str(row.dish_id),
        created_by=str(row.created_by) if row.created_by else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=_allowed(actor, row),
        can_delete=_allowed(actor, row),
    )


def _get_dish(db: Session, actor: Member, dish_id: uuid.UUID, *, lock=False) -> Dish:
    query = select(Dish).where(Dish.id == dish_id, Dish.family_id == actor.family_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = db.scalar(query)
    if row is None:
        raise AppError("NOT_FOUND", "غذا یافت نشد.", 404)
    return row


def _get_entry(db: Session, actor: Member, entry_id: uuid.UUID) -> MealEntry:
    row = db.scalar(
        select(MealEntry)
        .where(
            MealEntry.id == entry_id,
            MealEntry.family_id == actor.family_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise AppError("NOT_FOUND", "وعدهٔ غذایی یافت نشد.", 404)
    return row


def _ingredients(items: list[Ingredient]) -> list[dict]:
    grouped: dict[str, Ingredient] = {}
    for item in items:
        title = clean_title(item.title, "نام مادهٔ لازم")
        unit = clean_opt_text(item.unit, 20, "واحد")
        qty = (
            None if item.qty is None
            else clean_number(item.qty, "مقدار", minimum=Decimal("0.01"))
        )
        existing = grouped.get(title)
        if existing:
            if existing.unit != unit:
                raise AppError(
                    "UNIT_CONFLICT", f"واحدهای «{title}» متفاوت است؛ یک واحد مشخص کنید.", 422
                )
            qty = (
                None if existing.qty is None or qty is None
                else clean_number(existing.qty + qty, "مقدار", minimum=Decimal("0.01"))
            )
        grouped[title] = Ingredient(
            title=title,
            catalog_id=existing.catalog_id if existing else item.catalog_id,
            qty=qty,
            unit=unit,
        )
    # JSONB never receives raw Decimal objects.
    return [item.model_dump(mode="json") for item in grouped.values()]


def list_dishes(db: Session, actor: Member) -> list[DishOut]:
    rows = list(
        db.scalars(
            select(Dish)
            .where(Dish.family_id == actor.family_id)
            .order_by(Dish.title, Dish.created_at, Dish.id)
        )
    )
    references = set(
        db.scalars(
            select(MealEntry.dish_id).where(MealEntry.family_id == actor.family_id).distinct()
        )
    )
    return [_dish_out(row, actor, row.id in references) for row in rows]


def create_dish(db: Session, actor: Member, body: DishWrite) -> DishOut:
    row = create_dish_row(db, actor, body)
    db.commit()
    db.refresh(row)
    return _dish_out(row, actor, False)


def create_dish_row(db: Session, actor: Member, body: DishWrite) -> Dish:
    title = clean_title(body.title, "نام غذا")
    ingredients = _ingredients(body.ingredients)
    # Serialize dish-count checks for the household without locking any dish.
    db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    count = db.scalar(
        select(func.count()).select_from(Dish).where(Dish.family_id == actor.family_id)
    )
    if count >= _MAX_DISHES:
        raise AppError("LIMIT_REACHED", "تعداد غذاها به سقف رسیده است.", 409)
    row = Dish(family_id=actor.family_id, created_by=actor.id, title=title, ingredients=ingredients)
    db.add(row)
    return row


def update_dish(
    db: Session, actor: Member, dish_id: uuid.UUID, revision: int, body: DishWrite
) -> DishOut:
    row = _get_dish(db, actor, dish_id, lock=True)
    _authorize(actor, row, revision)
    row.title = clean_title(body.title, "نام غذا")
    row.ingredients = _ingredients(body.ingredients)
    flag_modified(row, "title")
    db.commit()
    db.refresh(row)
    return _dish_out(row, actor, _referenced(db, actor, row.id))


def delete_dish(db: Session, actor: Member, dish_id: uuid.UUID, revision: int) -> None:
    row = _get_dish(db, actor, dish_id, lock=True)
    _authorize(actor, row, revision)
    if _referenced(db, actor, row.id):
        raise AppError("DISH_IN_USE", "این غذا در برنامهٔ غذایی استفاده شده است.", 409)
    db.delete(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if (
            getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
            == "fk_meal_entry_dish_family"
        ):
            raise AppError("DISH_IN_USE", "این غذا در برنامهٔ غذایی استفاده شده است.", 409) from None
        raise


def week_start(raw: str) -> date:
    try:
        day = calendar_day(raw)
        day + timedelta(days=7)
    except (ValueError, OverflowError):
        raise AppError("INVALID_INPUT", "تاریخ شروع هفته نامعتبر است.", 422) from None
    if day.weekday() != 5:
        raise AppError("INVALID_INPUT", "شروع هفته باید شنبه باشد.", 422)
    return day


def plan(db: Session, actor: Member, start: date) -> MealPlanOut:
    rows = list(
        db.scalars(
            select(MealEntry).where(
                MealEntry.family_id == actor.family_id,
                MealEntry.date >= start,
                MealEntry.date < start + timedelta(days=7),
            )
        )
    )
    rows.sort(key=lambda row: (row.date, _MEAL_ORDER[row.meal_type]))
    return MealPlanOut(week_start=start, entries=[_entry_out(row, actor) for row in rows])


def _commit_entry(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if (
            getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
            == "uq_meal_entries_family_slot"
        ):
            raise AppError(
                "MEAL_SLOT_OCCUPIED", "برای این وعده قبلاً غذا انتخاب شده است.", 409
            ) from None
        raise


def create_entry_row(db: Session, actor: Member, body: MealEntryWrite) -> MealEntry:
    require_feature("meals", write=True)
    _get_dish(db, actor, body.dish_id, lock=True)
    row = MealEntry(
        family_id=actor.family_id,
        created_by=actor.id,
        date=body.date,
        meal_type=body.meal_type,
        dish_id=body.dish_id,
    )
    db.add(row)
    return row


def create_entry(db: Session, actor: Member, body: MealEntryWrite) -> MealEntryOut:
    row = create_entry_row(db, actor, body)
    _commit_entry(db)
    db.refresh(row)
    return _entry_out(row, actor)


def update_entry(
    db: Session, actor: Member, entry_id: uuid.UUID, body: MealEntryUpdate
) -> MealEntryOut:
    row = _get_entry(db, actor, entry_id)
    _authorize(actor, row, body.base_revision)
    _get_dish(db, actor, body.dish_id, lock=True)
    row.dish_id = body.dish_id
    flag_modified(row, "dish_id")
    _commit_entry(db)
    db.refresh(row)
    return _entry_out(row, actor)


def delete_entry(db: Session, actor: Member, entry_id: uuid.UUID, revision: int) -> None:
    row = _get_entry(db, actor, entry_id)
    _authorize(actor, row, revision)
    db.delete(row)
    db.commit()


def review_ingredients(
    db: Session, actor: Member, ingredients: list[Ingredient], *, lock=False
) -> list[IngredientCheck]:
    """Match exact reviewed catalog identities; unknown amounts never imply sufficiency."""
    entries = inventory_catalog.public_catalog(db)
    valid_ids = {entry.catalog_id for entry in entries}
    names: dict[str, set[str]] = {}
    for entry in entries:
        for name in [entry.title, *entry.aliases]:
            names.setdefault(inventory_catalog.name_key(name), set()).add(entry.catalog_id)

    def resolve(title: str, catalog_id: str | None) -> str | None:
        if catalog_id is not None:
            if catalog_id not in valid_ids:
                raise AppError("INVALID_INPUT", "شناسهٔ ماده در فهرست کالاها معتبر نیست.", 422)
            return catalog_id
        matches = names.get(inventory_catalog.name_key(title), set())
        return next(iter(matches)) if len(matches) == 1 else None

    query = (select(InventoryItem).where(InventoryItem.family_id == actor.family_id)
             .order_by(InventoryItem.id).execution_options(populate_existing=True))
    stock = list(db.scalars(query.with_for_update() if lock else query))
    by_id: dict[str, list[InventoryItem]] = {}
    for row in stock:
        catalog_id = resolve(row.title, row.catalog_id)
        if catalog_id:
            by_id.setdefault(catalog_id, []).append(row)
    checks = []
    for index, raw in enumerate(_ingredients(ingredients)):
        item = Ingredient(**raw)
        catalog_id = resolve(item.title, item.catalog_id)
        item.catalog_id = catalog_id
        rows = by_id.get(catalog_id, [])
        available = any(row.quantity > 0 for row in rows)
        if item.qty is not None:
            matching = [row for row in rows if row.unit == item.unit]
            total = sum((row.quantity for row in matching), Decimal(0))
            available = bool(matching) and total >= item.qty
        status = "unresolved" if catalog_id is None else "available" if available else "missing"
        checks.append(IngredientCheck(key=f"ingredient:{index}", ingredient=item, status=status))
    return checks


def commit_selection(db: Session, actor: Member, body: MealSelectionWrite) -> MealSelectionOut:
    """Recheck stock and atomically save one meal, selected purchases and opaque receipt."""
    encoded = json.dumps({"kind": "meal.confirm", "body": body.model_dump(mode="json")},
                         sort_keys=True, separators=(",", ":"))
    request_hash = hashlib.sha256(encoded.encode()).hexdigest()
    shopping._lock_operation(db, actor, body.operation_id)
    receipt = db.get(ShoppingSyncReceipt, (actor.family_id, actor.id, body.operation_id))
    if receipt is not None:
        if receipt.request_hash != request_hash:
            raise AppError(
                "OPERATION_REUSED", "شناسهٔ این تغییر قبلاً با اطلاعات دیگری استفاده شده است.", 409
            )
        entry = _get_entry(db, actor, receipt.entity_id)
        dish = _get_dish(db, actor, uuid.UUID(receipt.result_json["dish_id"]))
        return MealSelectionOut(entry=_entry_out(entry, actor), dish=_dish_out(dish, actor, True),
                                replayed=True, added_count=receipt.result_json["added_count"],
                                skipped_count=receipt.result_json["skipped_count"])
    # Match existing write lock order: family (new dish), entry, dish, list, inventory.
    if body.dish is not None:
        db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    entry = _get_entry(db, actor, body.entry_id) if body.entry_id else None
    if entry is not None:
        _authorize(actor, entry, body.base_revision)
        if entry.date != body.date or entry.meal_type != body.meal_type:
            raise AppError("SYNC_CONFLICT", "وعده تغییر کرده است؛ دوباره بررسی کنید.", 409)
    dish = _get_dish(db, actor, body.dish_id, lock=True) if body.dish_id else None
    if dish is not None and dish.revision != body.dish_revision:
        raise AppError("SYNC_CONFLICT", "مواد این غذا تغییر کرده است؛ دوباره بررسی کنید.", 409)
    ingredients = [Ingredient(**row) for row in dish.ingredients] if dish else body.dish.ingredients
    parent = shopping._get_list(db, actor, body.list_id) if body.list_id else None
    checks = review_ingredients(db, actor, ingredients, lock=True)
    choices = {choice.key: choice for choice in body.decisions}
    if len(choices) != len(body.decisions) or choices.keys() - {check.key for check in checks}:
        raise AppError("INVALID_INPUT", "گزینه‌های مواد اولیه را دوباره بررسی کنید.", 422)
    prepared: dict[str, dict] = {}
    catalog = inventory_catalog.public_catalog(db)
    canonical_titles = {row.catalog_id: row.title for row in catalog}
    name_ids: dict[str, set[str]] = {}
    for row in catalog:
        for name in [row.title, *row.aliases]:
            name_ids.setdefault(inventory_catalog.name_key(name), set()).add(row.catalog_id)

    def shopping_identity(title: str) -> str:
        key = inventory_catalog.name_key(title)
        matches = name_ids.get(key, set())
        return next(iter(matches)) if len(matches) == 1 else "title:" + key

    for check in checks:
        if check.status == "available":
            continue
        choice = choices.get(check.key)
        if choice is None:
            raise AppError(
                "MEAL_REVIEW_REQUIRED",
                "موجودی مواد تغییر کرده است؛ همهٔ اقلام ناموجود را تعیین تکلیف کنید.", 409
            )
        if choice.action == "available":
            continue
        if parent is None or choice.qty is None:
            raise AppError("INVALID_INPUT", "لیست خرید مقصد و مقدار هر ماده را مشخص کنید.", 422)
        item = check.ingredient
        # A catalog link provides one canonical shopping title, including aliases.
        canonical = canonical_titles.get(item.catalog_id, item.title)
        title = clean_title(canonical)
        unit = clean_opt_text(choice.unit, 20, "واحد")
        qty = clean_number(choice.qty, "مقدار خرید", minimum=Decimal("0.01"))
        if title in prepared:
            if prepared[title]["unit"] != unit:
                raise AppError(
                    "UNIT_CONFLICT", "برای مواد یکسان، واحد خرید یکسان انتخاب کنید.", 422
                )
            qty = clean_number(prepared[title]["qty"] + qty, "مقدار خرید", minimum=Decimal("0.01"))
        prepared[title] = {"title": title, "qty": qty, "unit": unit}
    # The existing shopping batch helper preserves quantities/prices on duplicates.
    added, skipped = (shopping.ensure_missing_rows(
        db, actor, parent, list(prepared.values()), identity_key=shopping_identity
    ) if prepared else ([], []))
    if dish is None:
        linked = [check.ingredient for check in checks]
        dish = create_dish_row(db, actor, DishWrite(title=body.dish.title, ingredients=linked))
        db.flush()
    if entry is None:
        entry = MealEntry(id=uuid.uuid4(), family_id=actor.family_id, created_by=actor.id,
                          date=body.date, meal_type=body.meal_type, dish_id=dish.id)
        db.add(entry)
    else:
        entry.dish_id = dish.id
        flag_modified(entry, "dish_id")
    db.add(ShoppingSyncReceipt(
        family_id=actor.family_id, member_id=actor.id, operation_id=body.operation_id,
        request_hash=request_hash, entity_type="meal", entity_id=entry.id, revision=None,
        result_json={"dish_id": str(dish.id), "added_count": len(added),
                     "skipped_count": len(skipped)}
    ))
    _commit_entry(db)
    db.refresh(entry)
    db.refresh(dish)
    return MealSelectionOut(entry=_entry_out(entry, actor), dish=_dish_out(dish, actor, True),
                            replayed=False, added_count=len(added), skipped_count=len(skipped))
