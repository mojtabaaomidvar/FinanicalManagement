"""زیردسته‌ها، دسته‌های سفارشی و بودجهٔ دسته‌ها — خواندن (فاز ۶) + نوشتن (فاز ۷).

خواندن — ترتیب‌ها دقیقاً مطابقِ RPCهای قدیمی:
- زیردسته‌ها: category صعودی، سپس created_at صعودی.
- دسته‌های سفارشی: created_at صعودی.
- بودجهٔ دسته‌ها: created_at صعودی.

نوشتن — معادلِ add/delete_subcategory، add/delete_custom_category و
set/delete_category_budget قدیمی با «همان» کدهای خطا:
- افزودنِ زیردسته/دستهٔ سفارشی idempotent است (ON CONFLICT DO NOTHING سپس
  بازخوانیِ ردیف) تا قرارداد «برگرداندنِ ردیف» هرگز خطا ندهد.
- حذفِ دستهٔ سفارشی اگر در تراکنشی به‌کار رفته باشد اجازه نمی‌دهد
  (CATEGORY_IN_USE) و در غیر این صورت زیردسته‌ها/بودجه‌های وابسته را هم پاک می‌کند.
- تعیین/حذفِ بودجه فقط برای مدیر (FORBIDDEN).

مرزِ خانواده در لایهٔ اپ (فیلترِ family_id) در کنارِ RLS.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.category import CategoryBudget, CustomCategory, Subcategory
from app.models.family import Member
from app.models.transaction import Transaction
from app.schemas.data import CategoryBudgetSet, CustomCategoryCreate, SubcategoryCreate

_MAX_BUDGET = 999999999999  # ۱۲ نُه — هم‌سان با set_category_budget قدیمی


def list_subcategories(db: Session, family_id: uuid.UUID) -> list[Subcategory]:
    return list(
        db.execute(
            select(Subcategory)
            .where(Subcategory.family_id == family_id)
            .order_by(Subcategory.category.asc(), Subcategory.created_at.asc())
        ).scalars()
    )


def list_custom_categories(db: Session, family_id: uuid.UUID) -> list[CustomCategory]:
    return list(
        db.execute(
            select(CustomCategory)
            .where(CustomCategory.family_id == family_id)
            .order_by(CustomCategory.created_at.asc())
        ).scalars()
    )


def list_category_budgets(db: Session, family_id: uuid.UUID) -> list[CategoryBudget]:
    return list(
        db.execute(
            select(CategoryBudget)
            .where(CategoryBudget.family_id == family_id)
            .order_by(CategoryBudget.created_at.asc())
        ).scalars()
    )


# ── کمک‌تابع‌ها ──────────────────────────────────────────────
def _valid_name(name: str | None) -> str:
    """نامِ زیردسته/دستهٔ سفارشی: ۱ تا ۳۰ کاراکتر (هم‌سان با اعتبارسنجیِ کلاینت)."""
    t = (name or "").strip()
    if not t or len(t) > 30:
        raise AppError("INVALID_CATEGORY", "نامِ دسته باید ۱ تا ۳۰ کاراکتر باشد.", 422)
    return t


# ── زیردسته‌ها ───────────────────────────────────────────────
def add_subcategory(
    db: Session, family_id: uuid.UUID, req: SubcategoryCreate
) -> Subcategory:
    """افزودنِ زیردسته؛ idempotent روی یکتاییِ (family, category, name)."""
    category = (req.category or "").strip()
    if not category or len(category) > 60:
        raise AppError("INVALID_CATEGORY", "دستهٔ والد نامعتبر است.", 422)
    name = _valid_name(req.name)
    db.execute(
        pg_insert(Subcategory)
        .values(family_id=family_id, category=category, name=name)
        .on_conflict_do_nothing(index_elements=["family_id", "category", "name"])
    )
    db.commit()
    return db.execute(
        select(Subcategory).where(
            Subcategory.family_id == family_id,
            Subcategory.category == category,
            Subcategory.name == name,
        )
    ).scalar_one()


def delete_subcategory(
    db: Session, family_id: uuid.UUID, subcategory_id: uuid.UUID
) -> None:
    row = db.execute(
        select(Subcategory).where(
            Subcategory.id == subcategory_id, Subcategory.family_id == family_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "زیردسته یافت نشد.", 404)
    db.delete(row)
    db.commit()


# ── دسته‌های سفارشی ──────────────────────────────────────────
def add_custom_category(
    db: Session, family_id: uuid.UUID, req: CustomCategoryCreate
) -> CustomCategory:
    """افزودنِ دستهٔ سفارشی؛ idempotent روی یکتاییِ (family, type, name)."""
    ctype = (req.type or "").strip()
    if ctype not in ("expense", "income"):
        raise AppError("INVALID_TYPE", "نوعِ دسته نامعتبر است.", 422)
    name = _valid_name(req.name)
    db.execute(
        pg_insert(CustomCategory)
        .values(family_id=family_id, type=ctype, name=name)
        .on_conflict_do_nothing(index_elements=["family_id", "type", "name"])
    )
    db.commit()
    return db.execute(
        select(CustomCategory).where(
            CustomCategory.family_id == family_id,
            CustomCategory.type == ctype,
            CustomCategory.name == name,
        )
    ).scalar_one()


def delete_custom_category(
    db: Session, family_id: uuid.UUID, category_id: uuid.UUID
) -> None:
    """حذفِ دستهٔ سفارشی. اگر در تراکنشی به‌کار رفته باشد → CATEGORY_IN_USE؛
    وگرنه زیردسته‌ها و بودجه‌های وابسته (کلید = id::text) هم پاک می‌شوند."""
    row = db.execute(
        select(CustomCategory).where(
            CustomCategory.id == category_id, CustomCategory.family_id == family_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "دسته یافت نشد.", 404)
    key = str(category_id)
    in_use = db.execute(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.family_id == family_id, Transaction.category == key)
    ).scalar_one()
    if in_use > 0:
        raise AppError(
            "CATEGORY_IN_USE", "این دسته در تراکنش‌ها به‌کار رفته و حذف نمی‌شود.", 409
        )
    db.execute(
        sa_delete(Subcategory).where(
            Subcategory.family_id == family_id, Subcategory.category == key
        )
    )
    db.execute(
        sa_delete(CategoryBudget).where(
            CategoryBudget.family_id == family_id, CategoryBudget.category == key
        )
    )
    db.delete(row)
    db.commit()


# ── بودجهٔ دسته‌ها (فقط مدیر) ────────────────────────────────
def set_category_budget(
    db: Session, actor: Member, req: CategoryBudgetSet
) -> CategoryBudget:
    """تعیین/به‌روزرسانیِ سقفِ بودجهٔ یک دسته — فقط مدیر (upsert روی (family, category))."""
    if actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    category = (req.category or "").strip()
    if not category or len(category) > 60:
        raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422)
    if req.amount is None or req.amount <= 0 or req.amount > _MAX_BUDGET:
        raise AppError("INVALID_AMOUNT", "مبلغِ بودجه نامعتبر است.", 422)
    db.execute(
        pg_insert(CategoryBudget)
        .values(family_id=actor.family_id, category=category, amount=req.amount)
        .on_conflict_do_update(
            index_elements=["family_id", "category"],
            set_={"amount": req.amount},
        )
    )
    db.commit()
    return db.execute(
        select(CategoryBudget).where(
            CategoryBudget.family_id == actor.family_id,
            CategoryBudget.category == category,
        )
    ).scalar_one()


def delete_category_budget(db: Session, actor: Member, category: str | None) -> None:
    """حذفِ سقفِ بودجهٔ یک دسته — فقط مدیر. کلید «رشتهٔ دسته» است و مثلِ آینهٔ
    set (upsert) بی‌اثرپذیر (idempotent) است؛ نبودِ بودجه خطا نمی‌دهد."""
    if actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    cat = (category or "").strip()
    if not cat:
        raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422)
    db.execute(
        sa_delete(CategoryBudget).where(
            CategoryBudget.family_id == actor.family_id,
            CategoryBudget.category == cat,
        )
    )
    db.commit()
