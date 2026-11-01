"""§۱.۹ قبوض و شارژ — سرویس.

تصمیم‌های معماری در `alembic/versions/0010_bills.py` مستند است. آن‌چه این‌جا
باید هنگامِ خواندنِ کد در ذهن باشد:

**۱) حالتِ قبض فقط با کنش عوض می‌شود، نه با PATCH.** `BillWrite` هیچ فیلدِ
`state` ندارد. وگرنه کلاینت می‌توانست قبض را «پرداخت‌شده» بنویسد بی‌آنکه
تراکنشی ساخته شود — یعنی خرجِ ماه کم‌تر از واقع، همان چیزی که تصمیمِ
«پرداخت خودش تراکنش بسازد» برای پرهیز از آن گرفته شد.

**۲) پرداخت یک commit است، نه دو.** `transactions.create_uncommitted` تراکنش
را می‌سازد و flush می‌کند (برای گرفتنِ id) ولی commit نمی‌کند؛ بعد قبض بسته
می‌شود و **یک** commit هر دو را می‌نشاند. با دو commit، شکستِ دومی یک
هزینهٔ یتیم در گزارش‌ها جا می‌گذاشت.

**۳) پرداختِ دوباره رد می‌شود.** بی این گارد، دو لمسِ پشت‌سرهم دو تراکنش
می‌ساخت و خرج دو برابر شمرده می‌شد.

**۴) اعتبارسنجیِ مبلغ دو جا هست** — این‌جا و در CHECKِ دیتابیس. تکرارِ
بی‌دلیل نیست: پیام فارسیِ درست از این‌جا می‌آید، و قیدِ دیتابیس تضمین
می‌کند هیچ مسیرِ دیگری (اسکریپت، مهاجرت، psql دستی) نتواند دورش بزند.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.bill import BILL_KINDS, Bill
from app.models.family import Member
from app.schemas.data import BillOut, BillPay, BillWrite, TransactionWrite
from app.services import transactions as tx_service
from app.services.clock import utcnow
from app.services.common import is_admin, to_uuid

# دستهٔ تراکنشی که پرداختِ قبض در آن می‌نشیند. عضوِ `_FIXED_CATEGORIES` در
# services/transactions.py است — اگر آن‌جا عوض شود، این‌جا هم باید عوض شود،
# و تستِ پرداخت همان را می‌گیرد.
_BILL_CATEGORY = "bills"

_MAX_TITLE = 120
_MAX_NO = 40


def _out(row: Bill) -> BillOut:
    return BillOut(
        id=str(row.id),
        kind=row.kind,
        title=row.title,
        amount=row.amount,
        due_date=row.due_date.isoformat(),
        bill_no=row.bill_no,
        payment_no=row.payment_no,
        state=row.state,
        paid_at=row.paid_at,
        paid_by_member_id=(
            str(row.paid_by_member_id) if row.paid_by_member_id else None
        ),
        transaction_id=str(row.transaction_id) if row.transaction_id else None,
        note=row.note,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
    )


def _clean_no(value: str | None) -> str | None:
    """شناسهٔ قبض/پرداخت — متن می‌ماند، فقط فاصله و ارقامِ فارسی نرمال می‌شوند.

    به عدد تبدیل **نمی‌شود**: شناسه‌های ایرانی صفرِ ابتدایی دارند و با
    عددشدن می‌افتد.
    """
    if value is None:
        return None
    text = value.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
    text = "".join(ch for ch in text if not ch.isspace())
    if not text:
        return None
    if len(text) > _MAX_NO:
        raise AppError("INVALID_INPUT", "شناسهٔ قبض بیش از حد بلند است.", 422)
    if not text.isdigit():
        raise AppError("INVALID_INPUT", "شناسهٔ قبض باید فقط رقم باشد.", 422)
    return text


def _prepare(req: BillWrite) -> dict:
    kind = (req.kind or "").strip()
    if kind not in BILL_KINDS:
        raise AppError("INVALID_INPUT", "نوع قبض نامعتبر است.", 422)
    title = (req.title or "").strip()
    if not title:
        raise AppError("INVALID_INPUT", "عنوان قبض لازم است.", 422)
    if len(title) > _MAX_TITLE:
        raise AppError("INVALID_INPUT", "عنوان قبض بیش از حد بلند است.", 422)
    if req.amount is None or req.amount <= Decimal(0):
        raise AppError("INVALID_AMOUNT", "مبلغ باید بزرگ‌تر از صفر باشد.", 422)
    if req.due_date is None:
        raise AppError("INVALID_DATE", "تاریخ سررسید لازم است.", 422)
    return {
        "kind": kind,
        "title": title,
        "amount": req.amount,
        "due_date": req.due_date,
        "bill_no": _clean_no(req.bill_no),
        "payment_no": _clean_no(req.payment_no),
        "note": (req.note or "").strip() or None,
    }


def _get(db: Session, actor: Member, bill_id: uuid.UUID) -> Bill:
    """قبضِ همین خانواده، وگرنه ۴۰۴.

    شرطِ `family_id` در لایهٔ اپ هم هست، هرچند RLS خودش ردیف را نمی‌دهد:
    اگر روزی وابستگیِ مسیر اشتباهاً `get_current_member` شود، این شرط مرز
    را نگه می‌دارد. (همان درسِ §۷.)
    """
    row = db.execute(
        select(Bill).where(Bill.id == bill_id, Bill.family_id == actor.family_id)
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "قبض یافت نشد.", 404)
    return row


# ── خواندن ───────────────────────────────────────────────────
def list_for_family(db: Session, actor: Member) -> list[BillOut]:
    """پرداخت‌نشده‌ها اول (به‌ترتیبِ سررسید)، بعد بقیه (تازه‌ترین اول).

    ترتیب در سرور تعیین می‌شود نه در UI، تا هر مصرف‌کننده‌ای (صفحهٔ قبوض،
    زیرنویسِ کاشیِ هاب، اعلان) یک فهرستِ یکسان ببیند.
    """
    rows = list(
        db.execute(
            select(Bill)
            .where(Bill.family_id == actor.family_id)
            .order_by(
                (Bill.state != "unpaid"),  # False(=0) اول → پرداخت‌نشده‌ها بالا
                Bill.due_date.asc(),
                Bill.created_at.desc(),
            )
        ).scalars()
    )
    return [_out(r) for r in rows]


# ── نوشتن ────────────────────────────────────────────────────
def create(db: Session, actor: Member, req: BillWrite) -> BillOut:
    values = _prepare(req)
    row = Bill(family_id=actor.family_id, created_by=actor.id, **values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


def update(db: Session, actor: Member, bill_id: uuid.UUID, req: BillWrite) -> BillOut:
    row = _get(db, actor, bill_id)
    if row.state == "paid":
        # مبلغِ قبضِ پرداخت‌شده دیگر با تراکنشش هم‌خوان نمی‌ماند.
        raise AppError(
            "BILL_ALREADY_PAID",
            "قبض پرداخت‌شده قابل ویرایش نیست. اگر اشتباه شده، پرداخت را برگردانید.",
            409,
        )
    for key, value in _prepare(req).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _out(row)


def remove(db: Session, actor: Member, bill_id: uuid.UUID) -> None:
    row = _get(db, actor, bill_id)
    if row.state == "paid":
        raise AppError(
            "BILL_ALREADY_PAID",
            "قبض پرداخت‌شده حذف نمی‌شود؛ تراکنشش در گزارش‌ها هست.",
            409,
        )
    db.delete(row)
    db.commit()


def cancel(db: Session, actor: Member, bill_id: uuid.UUID) -> BillOut:
    """«این قبض را نمی‌پردازم» — بی‌ساختِ تراکنش.

    جدا از حذف است: حذف سند را می‌برد، لغو نگهش می‌دارد ولی از فهرستِ
    بدهی و از اعلان‌ها بیرونش می‌کند.
    """
    row = _get(db, actor, bill_id)
    if row.state == "paid":
        raise AppError("BILL_ALREADY_PAID", "قبض پرداخت‌شده را نمی‌توان لغو کرد.", 409)
    row.state = "cancelled"
    db.commit()
    db.refresh(row)
    return _out(row)


def pay(db: Session, actor: Member, bill_id: uuid.UUID, req: BillPay) -> BillOut:
    """بستنِ قبض + ساختِ تراکنشِ هزینه — در **یک** commit.

    رابطهٔ `Bill ↕ Finance`ِ §۴.۷ و تصمیمِ مالک: یک منبعِ حقیقت برای پول.
    """
    row = _get(db, actor, bill_id)
    if row.state == "paid":
        raise AppError("BILL_ALREADY_PAID", "این قبض قبلاً پرداخت شده است.", 409)
    if row.state == "cancelled":
        raise AppError("BILL_CANCELLED", "قبضِ لغوشده پرداخت نمی‌شود.", 409)

    paid_on = req.date or utcnow().date()

    # تراکنش از همان موتورِ قاعدهٔ تراکنش می‌گذرد (اعتبارسنجیِ حساب، عضو،
    # دسته، مبلغ) — هیچ قاعده‌ای این‌جا دوباره نوشته نمی‌شود.
    tx = tx_service.create_uncommitted(
        db,
        actor.family_id,
        TransactionWrite(
            member_id=str(actor.id),
            type="expense",
            amount=row.amount,
            category=_BILL_CATEGORY,
            date=paid_on,
            account_id=req.account_id,
            note=row.title,
        ),
    )

    row.state = "paid"
    row.paid_at = utcnow()
    row.paid_by_member_id = actor.id
    row.transaction_id = tx.id
    db.commit()
    db.refresh(row)
    return _out(row)


def unpay(db: Session, actor: Member, bill_id: uuid.UUID) -> BillOut:
    """برگرداندنِ پرداخت — قبض به «پرداخت‌نشده» و تراکنشش حذف می‌شود.

    حذفِ تراکنش عمدی است و نه سخت‌گیری: اگر می‌ماند، کاربر یک هزینهٔ بی‌قبض
    در گزارش داشت که نمی‌دانست از کجا آمده، و قبض هم دوباره طلبکار می‌شد —
    یعنی همان پول دو بار شمرده می‌شد. هر دو در یک commit.
    """
    row = _get(db, actor, bill_id)
    if row.state != "paid":
        raise AppError("BILL_NOT_PAID", "این قبض پرداخت نشده است.", 409)

    # گاردِ مجوز این‌جا صریح است تا پیام درست باشد. بی آن،
    # `delete_uncommitted` برای عضوِ غیرمجاز «تراکنش یافت نشد» می‌داد که
    # دربارهٔ قبض گمراه‌کننده است.
    if not is_admin(actor) and row.paid_by_member_id != actor.id:
        raise AppError(
            "FORBIDDEN",
            "فقط پرداخت‌کننده یا مدیر خانواده می‌تواند پرداخت را برگرداند.",
            403,
        )

    if row.transaction_id is not None:
        tx_service.delete_uncommitted(db, actor, row.transaction_id)

    row.state = "unpaid"
    row.paid_at = None
    row.paid_by_member_id = None
    row.transaction_id = None
    db.commit()
    db.refresh(row)
    return _out(row)


def bill_uuid(raw: str) -> uuid.UUID:
    return to_uuid(raw, "NOT_FOUND", "قبض یافت نشد.", 404)
