"""تراکنش‌ها: خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

نوشتن‌ها معادلِ RPCهای قدیمی add/update/delete_transaction،
mark_recurring_occurrence و add/update_caption/delete_tx_photo هستند و «همان»
کدهای خطا را می‌دهند تا نگاشتِ خطای کلاینت پایدار بماند. رفع D-7: انتقالِ وجه یک
ردیف با account_id (مبدأ) + to_account_id (مقصد) + category='transfer' است.

مرزِ خانواده در لایهٔ اپ (فیلترِ family_id) هم اعمال می‌شود در کنار RLS — کمربند و
ساسپندر. همهٔ روت‌های این دامنه get_tenant_member می‌گیرند تا GUCِ RLS ست شود.
"""

from __future__ import annotations

import re
import uuid
from datetime import date as _date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.account import Account
from app.models.category import CustomCategory, Subcategory
from app.models.family import Member
from app.models.transaction import Transaction, TransactionPhoto
from app.schemas.data import PhotoCreate, TransactionWrite
from app.services.common import to_uuid, to_uuid_opt

_TIME_RE = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_REPEATS = {"none", "weekly", "monthly", "yearly"}
_TYPES = {"expense", "income", "transfer"}

# دسته‌های ثابتِ برنامه (هم‌سان با add_transaction قدیمی)
_FIXED_CATEGORIES = frozenset({
    "food", "home", "bills", "transport", "health", "clothing", "edu", "fun",
    "shopping", "comm", "finance", "insurance", "gifte", "family", "beauty",
    "sport", "pet", "other-e", "salary", "business", "invest", "sale", "gift",
    "other-i", "transfer",
})


# ── خواندن (فاز ۶) ───────────────────────────────────────────
def list_for_family(
    db: Session, family_id: uuid.UUID
) -> list[tuple[Transaction, list[TransactionPhoto]]]:
    """تراکنش‌های خانواده (نزولی بر created_at) به‌همراه عکس‌های هر تراکنش."""
    txs = list(
        db.execute(
            select(Transaction)
            .where(Transaction.family_id == family_id)
            .order_by(Transaction.created_at.desc())
        ).scalars()
    )
    photos = list(
        db.execute(
            select(TransactionPhoto)
            .where(TransactionPhoto.family_id == family_id)
            .order_by(TransactionPhoto.created_at.asc())
        ).scalars()
    )
    by_tx: dict[uuid.UUID, list[TransactionPhoto]] = {}
    for photo in photos:
        by_tx.setdefault(photo.transaction_id, []).append(photo)
    return [(tx, by_tx.get(tx.id, [])) for tx in txs]


# ── اعتبارسنجیِ مشترکِ افزودن/ویرایش ─────────────────────────
def _prepare(db: Session, family_id: uuid.UUID, req: TransactionWrite) -> dict:
    """قواعدِ سمت سرور را اعمال و مقادیرِ نرمال‌شدهٔ ستون‌ها را برمی‌گرداند."""
    if req.type not in _TYPES:
        raise AppError("INVALID_TYPE", "نوع تراکنش نامعتبر است.", 422)
    if req.amount is None or req.amount <= 0:
        raise AppError("INVALID_AMOUNT", "مبلغ باید بزرگ‌تر از صفر باشد.", 422)
    category = (req.category or "").strip()
    if not category:
        raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422)
    if req.date is None:
        raise AppError("INVALID_DATE", "تاریخ نامعتبر است.", 422)
    if req.time is not None and not _TIME_RE.match(req.time):
        raise AppError("INVALID_TIME", "ساعت نامعتبر است.", 422)
    if req.repeat not in _REPEATS:
        raise AppError("INVALID_REPEAT", "دورهٔ تکرار نامعتبر است.", 422)
    if req.repeat != "none":
        if req.repeat_end is None:
            raise AppError("REPEAT_END_REQUIRED", "تاریخ پایانِ تکرار لازم است.", 422)
        if req.repeat_end < req.date:
            raise AppError("INVALID_REPEAT_END", "تاریخ پایانِ تکرار پیش از تاریخ تراکنش است.", 422)

    # عضوِ منتسب باید در همین خانواده باشد
    member_id = to_uuid(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if db.execute(
        select(Member.id).where(Member.id == member_id, Member.family_id == family_id).limit(1)
    ).first() is None:
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # دسته: از لیستِ ثابت یا دستهٔ سفارشیِ همین خانواده با همین نوع
    if category not in _FIXED_CATEGORIES:
        try:
            custom_id = uuid.UUID(category)
        except ValueError:
            raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422) from None
        if db.execute(
            select(CustomCategory.id).where(
                CustomCategory.id == custom_id,
                CustomCategory.family_id == family_id,
                CustomCategory.type == req.type,
            ).limit(1)
        ).first() is None:
            raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422)

    # حساب منشا اختیاری؛ اگر داده شد باید مالِ همین خانواده باشد
    account_id = to_uuid_opt(req.account_id, "INVALID_ACCOUNT_ID", "حساب نامعتبر است.")
    if account_id is not None and db.execute(
        select(Account.id).where(Account.id == account_id, Account.family_id == family_id).limit(1)
    ).first() is None:
        raise AppError("INVALID_ACCOUNT_ID", "حساب نامعتبر است.", 422)

    # انتقالِ وجه: مبدأ و مقصد الزامی، متفاوت و متعلق به همین خانواده
    to_account_id = to_uuid_opt(req.to_account_id, "INVALID_ACCOUNT_ID", "حساب مقصد نامعتبر است.")
    if req.type == "transfer":
        if category != "transfer":
            raise AppError("INVALID_CATEGORY", "دستهٔ انتقال باید «transfer» باشد.", 422)
        if account_id is None or to_account_id is None or to_account_id == account_id:
            raise AppError("INVALID_TRANSFER", "انتقال به حساب مبدأ و مقصدِ متفاوت نیاز دارد.", 422)
        if db.execute(
            select(Account.id).where(Account.id == to_account_id, Account.family_id == family_id).limit(1)
        ).first() is None:
            raise AppError("INVALID_ACCOUNT_ID", "حساب مقصد نامعتبر است.", 422)

    # زیردسته باید متعلق به همین خانواده و همین دسته باشد
    subcategory_id = to_uuid_opt(req.subcategory_id, "INVALID_SUBCATEGORY", "زیردسته نامعتبر است.")
    if subcategory_id is not None and db.execute(
        select(Subcategory.id).where(
            Subcategory.id == subcategory_id,
            Subcategory.family_id == family_id,
            Subcategory.category == category,
        ).limit(1)
    ).first() is None:
        raise AppError("INVALID_SUBCATEGORY", "زیردسته نامعتبر است.", 422)

    note = (req.note or "").strip() or None
    return {
        "member_id": member_id,
        "type": req.type,
        "amount": req.amount,
        "category": category,
        "date": req.date,
        "time": req.time,
        "note": note,
        "account_id": account_id,
        "to_account_id": to_account_id,
        "subcategory_id": subcategory_id,
        "repeat": req.repeat,
        "repeat_end": req.repeat_end if req.repeat != "none" else None,
    }


# ── افزودن / ویرایش / حذف ────────────────────────────────────
def create(db: Session, family_id: uuid.UUID, req: TransactionWrite) -> Transaction:
    values = _prepare(db, family_id, req)
    row = Transaction(family_id=family_id, **values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update(db: Session, family_id: uuid.UUID, tx_id: uuid.UUID, req: TransactionWrite) -> None:
    values = _prepare(db, family_id, req)
    row = db.execute(
        select(Transaction).where(Transaction.id == tx_id, Transaction.family_id == family_id)
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()


def delete(db: Session, actor: Member, tx_id: uuid.UUID) -> None:
    """حذف: مدیر هر تراکنشِ خانواده؛ عضو فقط تراکنشِ خودش."""
    stmt = select(Transaction).where(
        Transaction.id == tx_id, Transaction.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(Transaction.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)
    db.delete(row)
    db.commit()


def mark_occurrence(db: Session, actor: Member, tx_id: uuid.UUID, due_date: _date | None) -> None:
    """ثبتِ رسیدگی به یک سررسیدِ تراکنش تکرارشونده (فقط مدیر؛ idempotent)."""
    if actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    if due_date is None:
        raise AppError("INVALID_DATE", "تاریخِ سررسید نامعتبر است.", 422)
    row = db.execute(
        select(Transaction).where(Transaction.id == tx_id, Transaction.family_id == actor.family_id)
    ).scalar_one_or_none()
    if row is None or row.repeat == "none":
        raise AppError("NOT_FOUND", "تراکنشِ تکرارشونده یافت نشد.", 404)
    key = due_date.isoformat()
    occ = list(row.handled_occurrences or [])
    if key not in occ:
        occ.append(key)
        row.handled_occurrences = occ  # بازتخصیصِ لیستِ تازه تا تغییرِ JSONB ردیابی شود
        db.commit()


# ── عکس‌های تراکنش ───────────────────────────────────────────
def _photo_permitted(db: Session, actor: Member, photo: TransactionPhoto) -> bool:
    """مجاز: مدیر، آپلودر، یا سازندهٔ تراکنشِ همان عکس."""
    if actor.role == "owner" or photo.member_id == actor.id:
        return True
    creator = db.execute(
        select(Transaction.member_id).where(
            Transaction.id == photo.transaction_id, Transaction.family_id == actor.family_id
        ).limit(1)
    ).scalar_one_or_none()
    return creator == actor.id


def add_photo(db: Session, actor: Member, tx_id: uuid.UUID, req: PhotoCreate) -> TransactionPhoto:
    if db.execute(
        select(Transaction.id).where(
            Transaction.id == tx_id, Transaction.family_id == actor.family_id
        ).limit(1)
    ).first() is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)
    url = (req.url or "").strip()
    if len(url) < 10 or len(req.url or "") > 500:
        raise AppError("INVALID_URL", "نشانیِ تصویر نامعتبر است.", 422)
    caption = (req.caption or "").strip()
    if len(caption) > 100:
        raise AppError("INVALID_CAPTION", "توضیحِ تصویر بیش از حد بلند است.", 422)
    row = TransactionPhoto(
        family_id=actor.family_id,
        transaction_id=tx_id,
        member_id=actor.id,
        url=url,
        caption=caption or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_photo_caption(db: Session, actor: Member, photo_id: uuid.UUID, caption: str | None) -> None:
    text = (caption or "").strip()
    if len(text) > 100:
        raise AppError("INVALID_CAPTION", "توضیحِ تصویر بیش از حد بلند است.", 422)
    photo = db.execute(
        select(TransactionPhoto).where(
            TransactionPhoto.id == photo_id, TransactionPhoto.family_id == actor.family_id
        )
    ).scalar_one_or_none()
    if photo is None or not _photo_permitted(db, actor, photo):
        raise AppError("NOT_FOUND", "تصویر یافت نشد.", 404)
    photo.caption = text or None
    db.commit()


def delete_photo(db: Session, actor: Member, photo_id: uuid.UUID) -> None:
    photo = db.execute(
        select(TransactionPhoto).where(
            TransactionPhoto.id == photo_id, TransactionPhoto.family_id == actor.family_id
        )
    ).scalar_one_or_none()
    if photo is None or not _photo_permitted(db, actor, photo):
        raise AppError("NOT_FOUND", "تصویر یافت نشد.", 404)
    db.delete(photo)
    db.commit()
