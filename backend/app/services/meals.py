"""Tenant-bound meal planning with creator/admin permission and revision checks."""

from __future__ import annotations

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
from app.schemas.meals import (
    DishOut,
    DishWrite,
    Ingredient,
    MealEntryOut,
    MealEntryUpdate,
    MealEntryWrite,
    MealPlanOut,
    calendar_day,
)
from app.services.common import is_admin
from app.services.inventory import clean_number, clean_opt_text, clean_title

_MAX_DISHES = 200
_MEAL_ORDER = {"breakfast": 0, "lunch": 1, "dinner": 2}


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
        grouped[title] = Ingredient(title=title, qty=qty, unit=unit)
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
    db.commit()
    db.refresh(row)
    return _dish_out(row, actor, False)


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
