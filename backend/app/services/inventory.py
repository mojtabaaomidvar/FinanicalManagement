"""§۱.۸ انبار خانه — سرویس.

تصمیم‌های معماری در `alembic/versions/0011_shopping.py` مستند است. آن‌چه
هنگامِ خواندنِ این فایل باید در ذهن باشد:

**۱) `threshold == 0` یعنی «آستانه ندارد».** نه کم شمرده می‌شود نه اعلان
می‌دهد. پس `is_low` هرگز برای قلمی که کاربر آستانه‌اش را نگذاشته true
نمی‌شود — وگرنه همهٔ اقلامِ تمام‌شده‌ای که اصلاً مهم نیستند زنگ می‌زدند.

**۲) مرتب‌سازی در پایتون است، نه `ORDER BY`.** همان دلیلِ `services/events.py`:
SQLAlchemy در محیطِ وارسیِ من نصب نیست، پس یک `ORDER BY` با `CASE`
آزمایش‌نشده می‌ماند و خرابی‌اش فهرستِ انبار را ۵۰۰ می‌کند — فهرستی که هم
صفحهٔ انبار، هم زیرنویسِ کاشیِ هاب و هم اعلانِ §۷ از آن می‌خوانند.

**۳) تغییرِ موجودی نسبی است (`delta`)، نه مطلق.** دو نفر می‌توانند هم‌زمان
انبار را دست بزنند؛ «بگذار روی ۳» آخرین‌نویسنده-برنده است ولی «یکی کم
کن» نیست.

**۴) عنوانِ تکراری در سطحِ دیتابیس هم بسته است.** این‌جا فقط برای پیامِ
فارسیِ درست بررسی می‌شود؛ قیدِ یکتاییِ `uq_inventory_family_title` تضمین
می‌کند هیچ مسیرِ دیگری نتواند دورش بزند.
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.family import Member
from app.models.shopping import InventoryItem
from app.schemas.data import InventoryOut, InventoryWrite
from app.services.clock import utcnow
from app.services.common import to_uuid

_MAX_TITLE = 120
_MAX_UNIT = 20
_MAX_NOTE = 500
# سقفِ ستون Numeric(10, 2) است؛ این‌جا کمی پایین‌تر گرفته می‌شود تا پیامِ
# فارسی بدهیم نه خطای خامِ دیتابیس.
_MAX_QTY = Decimal("99999999")
_CENT = Decimal("0.01")


def is_low(row: InventoryItem) -> bool:
    """آیا این قلم زیرِ آستانه است؟ آستانهٔ صفر یعنی «بی‌آستانه»."""
    return row.threshold > 0 and row.quantity <= row.threshold


def _out(row: InventoryItem) -> InventoryOut:
    return InventoryOut(
        id=str(row.id),
        title=row.title,
        unit=row.unit,
        quantity=row.quantity,
        threshold=row.threshold,
        note=row.note,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def clean_title(value: str | None, label: str = "نام قلم") -> str:
    text = " ".join((value or "").split())
    if not text:
        raise AppError("INVALID_INPUT", f"{label} لازم است.", 422)
    if len(text) > _MAX_TITLE:
        raise AppError("INVALID_INPUT", f"{label} بیش از حد بلند است.", 422)
    return text


def clean_opt_text(value: str | None, limit: int, label: str) -> str | None:
    text = " ".join((value or "").split())
    if not text:
        return None
    if len(text) > limit:
        raise AppError("INVALID_INPUT", f"{label} بیش از حد بلند است.", 422)
    return text


def clean_number(
    value: Decimal | None,
    label: str,
    *,
    default: Decimal = Decimal(0),
    minimum: Decimal = Decimal(0),
) -> Decimal:
    """عدد را به دو رقمِ اعشار گرد می‌کند و مرزها را می‌بندد.

    گردکردن این‌جا انجام می‌شود نه در دیتابیس: اگر ستون خودش گرد کند،
    مقداری که کاربر فرستاده با مقداری که برمی‌گردد فرق می‌کند و UI
    می‌لرزد.
    """
    if value is None:
        return default
    try:
        num = Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise AppError("INVALID_INPUT", f"{label} نامعتبر است.", 422) from None
    if num < minimum:
        # پیام به مرز بسته است، نه ثابت: برای `minimum=0` حرفِ درست «منفی
        # نباشد» است و برای تعدادِ قلم («حداقل ۰٫۰۱») «بزرگ‌تر از صفر».
        if minimum > 0:
            raise AppError("INVALID_INPUT", f"{label} باید بزرگ‌تر از صفر باشد.", 422)
        raise AppError("INVALID_INPUT", f"{label} نمی‌تواند منفی باشد.", 422)
    if num > _MAX_QTY:
        raise AppError("INVALID_INPUT", f"{label} بیش از حد بزرگ است.", 422)
    return num


def _prepare(req: InventoryWrite) -> dict:
    return {
        "title": clean_title(req.title),
        "unit": clean_opt_text(req.unit, _MAX_UNIT, "واحد"),
        "quantity": clean_number(req.quantity, "موجودی"),
        "threshold": clean_number(req.threshold, "آستانهٔ کمبود"),
        "note": clean_opt_text(req.note, _MAX_NOTE, "یادداشت"),
    }


def _get(db: Session, actor: Member, item_id: uuid.UUID) -> InventoryItem:
    """قلمِ همین خانواده، وگرنه ۴۰۴.

    شرطِ `family_id` در لایهٔ اپ هم هست، هرچند RLS خودش ردیف را نمی‌دهد:
    اگر روزی وابستگیِ مسیر اشتباهاً `get_current_member` شود، این شرط مرز
    را نگه می‌دارد. (همان درسِ §۷.)
    """
    row = db.execute(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.family_id == actor.family_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "قلم انبار یافت نشد.", 404)
    return row


def _assert_unique(
    db: Session,
    family_id: uuid.UUID,
    title: str,
    *,
    exclude: uuid.UUID | None = None,
) -> None:
    stmt = select(InventoryItem.id).where(
        InventoryItem.family_id == family_id, InventoryItem.title == title
    )
    if exclude is not None:
        stmt = stmt.where(InventoryItem.id != exclude)
    if db.execute(stmt).first() is not None:
        raise AppError(
            "DUPLICATE",
            f"«{title}» از قبل در انبار هست؛ به‌جای قلمِ تازه، موجودی همان را تغییر دهید.",
            409,
        )


# ── خواندن ───────────────────────────────────────────────────
def list_for_family(db: Session, actor: Member) -> list[InventoryOut]:
    """کم‌شده‌ها اول، بعد بقیه — هر گروه بر پایهٔ نام.

    ترتیب در سرور تعیین می‌شود نه در UI، تا صفحهٔ انبار و زیرنویسِ کاشیِ
    هاب یک فهرستِ یکسان ببینند (همان قاعدهٔ `services/bills.py`).
    """
    rows = list(
        db.execute(
            select(InventoryItem).where(InventoryItem.family_id == actor.family_id)
        ).scalars()
    )
    rows.sort(key=lambda r: (0 if is_low(r) else 1, r.title))
    return [_out(r) for r in rows]


# ── نوشتن ────────────────────────────────────────────────────
def create(db: Session, actor: Member, req: InventoryWrite) -> InventoryOut:
    values = _prepare(req)
    _assert_unique(db, actor.family_id, values["title"])
    row = InventoryItem(family_id=actor.family_id, created_by=actor.id, **values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


def update(
    db: Session, actor: Member, item_id: uuid.UUID, req: InventoryWrite
) -> InventoryOut:
    row = _get(db, actor, item_id)
    values = _prepare(req)
    _assert_unique(db, actor.family_id, values["title"], exclude=row.id)
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return _out(row)


def adjust(
    db: Session, actor: Member, item_id: uuid.UUID, delta: Decimal
) -> InventoryOut:
    """«+۱» / «−۱» روی موجودی.

    نتیجهٔ منفی به صفر گرفته می‌شود، نه خطا: کاربری که پشتِ‌هم «−» می‌زند
    منظورش «تمام شد» است، و خطادادن فقط سرِ راهش بود. قیدِ دیتابیس هم
    همین مرز را دارد.
    """
    row = _get(db, actor, item_id)
    try:
        step = Decimal(delta).quantize(_CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise AppError("INVALID_INPUT", "مقدار نامعتبر است.", 422) from None
    if step == 0:
        return _out(row)
    if abs(step) > _MAX_QTY:
        raise AppError("INVALID_INPUT", "مقدار بیش از حد بزرگ است.", 422)

    nxt = row.quantity + step
    if nxt < 0:
        nxt = Decimal(0)
    if nxt > _MAX_QTY:
        raise AppError("INVALID_INPUT", "موجودی بیش از حد بزرگ است.", 422)
    row.quantity = nxt
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return _out(row)


def bump_uncommitted(
    db: Session, family_id: uuid.UUID, item_id: uuid.UUID, delta: Decimal
) -> None:
    """افزایشِ موجودی **بدون commit** — برای بستنِ سفرِ خرید.

    هم‌تایِ `transactions.create_uncommitted`: بالا رفتنِ انبار و بسته‌شدنِ
    سفر باید در **یک** commit بنشینند، وگرنه شکستِ دومی انباری می‌ساخت که
    پر شده ولی خریدش ثبت نشده.

    قلمِ ناپیدا بی‌صدا رد می‌شود: `inventory_item_id` با `SET NULL` قطع
    می‌شود و نبودِ ردیف نباید کلِ سفرِ خرید را بیندازد.
    """
    row = db.execute(
        select(InventoryItem).where(
            InventoryItem.id == item_id, InventoryItem.family_id == family_id
        )
    ).scalar_one_or_none()
    if row is None:
        return
    nxt = row.quantity + delta
    if nxt < 0:
        nxt = Decimal(0)
    if nxt > _MAX_QTY:
        nxt = _MAX_QTY
    row.quantity = nxt
    row.updated_at = utcnow()


def remove(db: Session, actor: Member, item_id: uuid.UUID) -> None:
    row = _get(db, actor, item_id)
    db.delete(row)
    db.commit()


def inventory_uuid(raw: str) -> uuid.UUID:
    return to_uuid(raw, "NOT_FOUND", "قلم انبار یافت نشد.", 404)
