"""تراکنش‌ها: خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

نوشتن‌ها معادل RPCهای قدیمی add/update/delete_transaction،
mark_recurring_occurrence و add/update_caption/delete_tx_photo هستند و «همان»
کدهای خطا را می‌دهند تا نگاشت خطای کلاینت پایدار بماند. رفع D-7: انتقال وجه یک
ردیف با account_id (مبدأ) + to_account_id (مقصد) + category='transfer' است.

مرز خانواده در لایهٔ اپ (فیلتر family_id) هم اعمال می‌شود در کنار RLS — کمربند و
ساسپندر. همهٔ روت‌های این دامنه get_tenant_member می‌گیرند تا GUC RLS ست شود.
"""

from __future__ import annotations

import re
import uuid
from datetime import date as _date
from decimal import Decimal
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.core.errors import AppError
from app.models.account import Account
from app.models.category import CustomCategory, Subcategory
from app.models.family import Member
from app.models.transaction import Transaction, TransactionPhoto
from app.schemas.data import OccurrenceSettle, PhotoCreate, RecurringUpdate, TransactionWrite
from app.services.common import is_admin, to_uuid, to_uuid_opt
from app.services.member_age import document_age_restricted, today_tehran
from app.services.transfer_fees import TRANSFER_METHODS, calculate_transfer_fee_rial

_TIME_RE = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_REPEATS = {"none", "weekly", "monthly", "yearly"}
_TYPES = {"expense", "income", "transfer"}

# دسته‌های ثابت برنامه (هم‌سان با add_transaction قدیمی)
_FIXED_CATEGORIES = frozenset(
    {
        "food",
        "home",
        "bills",
        "transport",
        "health",
        "clothing",
        "edu",
        "fun",
        "shopping",
        "comm",
        "finance",
        "insurance",
        "gifte",
        "family",
        "beauty",
        "sport",
        "pet",
        "other-e",
        "salary",
        "business",
        "invest",
        "sale",
        "gift",
        "other-i",
        "transfer",
    }
)


# ── خواندن (فاز ۶) ───────────────────────────────────────────
def list_for_family(
    db: Session, family_id: uuid.UUID, actor: Member | None = None
) -> list[tuple[Transaction, list[TransactionPhoto]]]:
    """تراکنش‌های خانواده (نزولی بر created_at) به‌همراه عکس‌های هر تراکنش."""
    query = select(Transaction).where(Transaction.family_id == family_id)
    if actor is not None and document_age_restricted(actor):
        query = query.where(Transaction.source_kind.is_distinct_from("vehicle_service"))
    txs = list(db.scalars(query.order_by(Transaction.created_at.desc())))
    photos = list(
        db.execute(
            select(TransactionPhoto)
            .where(
                TransactionPhoto.family_id == family_id,
                TransactionPhoto.transaction_id.in_([tx.id for tx in txs]),
            )
            .order_by(TransactionPhoto.created_at.asc())
        ).scalars()
    )
    by_tx: dict[uuid.UUID, list[TransactionPhoto]] = {}
    for photo in photos:
        by_tx.setdefault(photo.transaction_id, []).append(photo)
    return [(tx, by_tx.get(tx.id, [])) for tx in txs]


def _require_source_access(actor: Member, row: Transaction) -> None:
    if row.source_kind == "vehicle_service" and (
        document_age_restricted(actor)
        or actor.status != "active"
        or actor.membership_state != "active"
    ):
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)


# ── اعتبارسنجی مشترک افزودن/ویرایش ─────────────────────────
def _prepare(db: Session, family_id: uuid.UUID, req: TransactionWrite) -> dict:
    """قواعد سمت سرور را اعمال و مقادیر نرمال‌شدهٔ ستون‌ها را برمی‌گرداند."""
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
            raise AppError("REPEAT_END_REQUIRED", "تاریخ پایان تکرار لازم است.", 422)
        if req.repeat_end < req.date:
            raise AppError("INVALID_REPEAT_END", "تاریخ پایان تکرار پیش از تاریخ تراکنش است.", 422)

    # عضو منتسب باید در همین خانواده باشد
    member_id = to_uuid(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if (
        db.execute(
            select(Member.id).where(Member.id == member_id, Member.family_id == family_id).limit(1)
        ).first()
        is None
    ):
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # دسته: از لیست ثابت یا دستهٔ سفارشی همین خانواده با همین نوع
    if category not in _FIXED_CATEGORIES:
        try:
            custom_id = uuid.UUID(category)
        except ValueError:
            raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422) from None
        if (
            db.execute(
                select(CustomCategory.id)
                .where(
                    CustomCategory.id == custom_id,
                    CustomCategory.family_id == family_id,
                    CustomCategory.type == req.type,
                )
                .limit(1)
            ).first()
            is None
        ):
            raise AppError("INVALID_CATEGORY", "دسته نامعتبر است.", 422)

    # حساب منشا اختیاری؛ اگر داده شد باید مال همین خانواده باشد
    account_id = to_uuid_opt(req.account_id, "INVALID_ACCOUNT_ID", "حساب نامعتبر است.")
    if (
        account_id is not None
        and db.execute(
            select(Account.id)
            .where(Account.id == account_id, Account.family_id == family_id)
            .limit(1)
        ).first()
        is None
    ):
        raise AppError("INVALID_ACCOUNT_ID", "حساب نامعتبر است.", 422)

    # انتقال وجه: مبدأ و مقصد الزامی، متفاوت و متعلق به همین خانواده
    to_account_id = to_uuid_opt(req.to_account_id, "INVALID_ACCOUNT_ID", "حساب مقصد نامعتبر است.")
    if req.type == "transfer":
        if category != "transfer":
            raise AppError("INVALID_CATEGORY", "دستهٔ انتقال باید «transfer» باشد.", 422)
        if account_id is None or to_account_id is None or to_account_id == account_id:
            raise AppError("INVALID_TRANSFER", "انتقال به حساب مبدأ و مقصد متفاوت نیاز دارد.", 422)
        if (
            db.execute(
                select(Account.id)
                .where(Account.id == to_account_id, Account.family_id == family_id)
                .limit(1)
            ).first()
            is None
        ):
            raise AppError("INVALID_ACCOUNT_ID", "حساب مقصد نامعتبر است.", 422)

    # زیردسته باید متعلق به همین خانواده و همین دسته باشد
    subcategory_id = to_uuid_opt(req.subcategory_id, "INVALID_SUBCATEGORY", "زیردسته نامعتبر است.")
    if (
        subcategory_id is not None
        and db.execute(
            select(Subcategory.id)
            .where(
                Subcategory.id == subcategory_id,
                Subcategory.family_id == family_id,
                Subcategory.category == category,
            )
            .limit(1)
        ).first()
        is None
    ):
        raise AppError("INVALID_SUBCATEGORY", "زیردسته نامعتبر است.", 422)

    note = (req.note or "").strip() or None
    fee_method = req.transfer_fee_method
    fee_rial = None
    if fee_method is not None:
        if req.type != "transfer" or fee_method not in TRANSFER_METHODS:
            raise AppError("INVALID_TRANSFER_FEE", "نوع انتقال را انتخاب کنید.", 422)
        bank_accounts = list(db.scalars(select(Account).where(
            Account.family_id == family_id, Account.id.in_([account_id, to_account_id]))))
        if len(bank_accounts) != 2 or any(account.kind != "bank" for account in bank_accounts):
            raise AppError("INVALID_TRANSFER_FEE", "کارمزد انتقال فقط برای انتقال بین دو حساب بانکی است.", 422)
        rial = req.amount * 10
        if rial != rial.to_integral_value():
            raise AppError("INVALID_TRANSFER_FEE", "مبلغ انتقال باید عدد صحیح مثبت به ریال باشد.", 422)
        fee_rial = calculate_transfer_fee_rial(fee_method, int(rial))
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
        "transfer_fee_method": fee_method,
        "transfer_fee_rial": fee_rial,
    }


# ── افزودن / ویرایش / حذف ────────────────────────────────────
def create_uncommitted(
    db: Session,
    family_id: uuid.UUID,
    req: TransactionWrite,
    *,
    source_kind: Literal["vehicle_service"] | None = None,
) -> Transaction:
    """تراکنش را می‌سازد و `flush` می‌کند — **بدون commit**.

    برای فراخوانی که باید تراکنش را داخلِ واحدِ کارِ خودش بسازد. امروز تنها
    مصرف‌کننده‌اش `services/bills.pay` است و دلیلش اتمیک‌بودن است: اگر پرداخت
    با `create()` (که خودش commit می‌کند) ساخته می‌شد، بینِ دو commit پنجره‌ای
    می‌ماند که تراکنشِ هزینه وجود دارد ولی قبض هنوز «پرداخت‌نشده» است. شکستِ
    commitِ دوم یعنی یک هزینهٔ یتیم در گزارش‌ها — همان شمارشِ دوبلی که کلِ
    تصمیمِ «پرداخت خودش تراکنش بسازد» برای پرهیز از آن گرفته شد.

    `flush` لازم است تا `row.id` پیش از بازگشت مقدار بگیرد (قبض باید آن را
    در `transaction_id` بنشاند).

    همهٔ اعتبارسنجی‌ها از `_prepare` می‌آید، پس هیچ قاعده‌ای دوباره نوشته
    نمی‌شود: یک موتورِ قاعده، یک commit.
    """
    values = _prepare(db, family_id, req)
    row = Transaction(family_id=family_id, source_kind=source_kind, **values)
    db.add(row)
    db.flush()
    return row


def create_vehicle_service_uncommitted(
    db: Session,
    actor: Member,
    amount: Decimal,
    performed_on: _date,
    account_id: uuid.UUID | None,
    description: str,
) -> Transaction:
    """Finance owns the generated expense's origin; the caller commits its unit of work."""
    return create_uncommitted(
        db,
        actor.family_id,
        TransactionWrite(
            member_id=str(actor.id),
            type="expense",
            category="transport",
            amount=amount,
            date=performed_on,
            note=description[:200],
            account_id=str(account_id) if account_id else None,
            repeat="none",
        ),
        source_kind="vehicle_service",
    )


def create(
    db: Session, family_id: uuid.UUID, req: TransactionWrite, *, actor: Member | None = None
) -> Transaction:
    values = _prepare(db, family_id, req)
    if actor is not None:
        _check_payment_account(db, actor, values, req.require_available_balance or values["transfer_fee_method"] is not None)
    row = Transaction(family_id=family_id, **values)
    db.add(row)
    db.flush()
    _sync_transfer_fee(db, row)
    db.commit()
    db.refresh(row)
    return row


def update(db: Session, actor: Member, tx_id: uuid.UUID, req: TransactionWrite) -> None:
    """ویرایش: مدیر هر تراکنش خانواده؛ عضو فقط تراکنش خودش، بدون تغییر عضو منتسب."""
    is_family_admin = is_admin(actor)
    stmt = select(Transaction).where(
        Transaction.id == tx_id, Transaction.family_id == actor.family_id
    )
    if not is_family_admin:
        stmt = stmt.where(Transaction.member_id == actor.id)
    # مالکیت ردیف تا پایان ویرایش ثابت می‌ماند، حتی اگر مدیر هم‌زمان آن را تغییر دهد.
    row = db.execute(stmt.with_for_update()).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)

    _require_source_access(actor, row)
    if row.source_kind == "transfer_fee":
        raise AppError("SOURCE_IMMUTABLE", "کارمزد همراه انتقال مدیریت می‌شود؛ انتقال اصلی را ویرایش یا حذف کنید.", 422)
    if "transfer_fee_method" not in req.model_fields_set and req.type == "transfer":
        req = req.model_copy(update={"transfer_fee_method": row.transfer_fee_method})
    values = _prepare(db, actor.family_id, req)
    if all(values[key] == getattr(row, key) for key in ("amount", "type", "account_id", "to_account_id", "transfer_fee_method")):
        values["transfer_fee_rial"] = row.transfer_fee_rial
    _check_payment_account(db, actor, values, req.require_available_balance or values["transfer_fee_method"] is not None, replacing=row)
    if row.source_kind == "vehicle_service" and (
        any(
            values[key] != getattr(row, key)
            for key in (
                "type",
                "category",
                "date",
                "member_id",
                "repeat",
                "repeat_end",
                "to_account_id",
            )
        )
        or req.repeat_end != row.repeat_end
    ):
        raise AppError(
            "SOURCE_IMMUTABLE", "نوع، دسته، تاریخ، عضو و تکرار هزینهٔ سرویس ثابت‌اند.", 422
        )
    if not is_family_admin and values["member_id"] != actor.id:
        raise AppError("FORBIDDEN", "نمی‌توانید تراکنش خود را به عضو دیگری نسبت دهید.", 403)
    if (row.repeat, row.repeat_end) != (values["repeat"], values["repeat_end"]):
        row.recurring_revision += 1
    for key, value in values.items():
        setattr(row, key, value)
    _sync_transfer_fee(db, row)
    db.commit()


def delete_uncommitted(db: Session, actor: Member, tx_id: uuid.UUID) -> None:
    """مثل `delete` ولی **بدون commit** — برای فراخوانی که واحدِ کارِ خودش را دارد.

    قاعدهٔ مجوز (مدیر هر تراکنش، عضو فقط تراکنشِ خودش) این‌جاست و `delete`
    خودش از همین عبور می‌کند، تا دو نسخهٔ مجوز وجود نداشته باشد.
    امروز تنها مصرف‌کنندهٔ بیرونی‌اش `services/bills.unpay` است.
    """
    stmt = select(Transaction).where(
        Transaction.id == tx_id, Transaction.family_id == actor.family_id
    )
    if not is_admin(actor):
        stmt = stmt.where(Transaction.member_id == actor.id)
    row = db.execute(stmt.with_for_update()).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)
    _require_source_access(actor, row)
    if row.source_kind == "transfer_fee":
        raise AppError("SOURCE_IMMUTABLE", "کارمزد همراه انتقال مدیریت می‌شود؛ انتقال اصلی را ویرایش یا حذف کنید.", 422)
    if (
        db.scalar(
            select(Transaction.id)
            .where(
                Transaction.family_id == actor.family_id,
                Transaction.recurring_source_id == row.id,
            )
            .limit(1)
        )
        is not None
    ):
        raise AppError(
            "RECURRING_HISTORY_EXISTS",
            "این تراکنش نوبت تسویه‌شده دارد؛ تکرار را متوقف کنید تا سابقه حفظ شود.",
            409,
        )
    db.delete(row)
    db.flush()


def _sync_transfer_fee(db: Session, parent: Transaction) -> None:
    """One derived fee expense, in the parent's unit of work; never a second commit."""
    fee = db.scalar(select(Transaction).where(
        Transaction.family_id == parent.family_id, Transaction.transfer_fee_for_id == parent.id))
    amount = Decimal(parent.transfer_fee_rial or 0) / 10
    if amount == 0:
        if fee is not None:
            db.delete(fee)
        return
    # This is a stored system tag, distinct from editable display copy.
    tag_name = "کارمزد انتقال"
    db.execute(insert(Subcategory).values(family_id=parent.family_id, category="finance", name=tag_name)
               .on_conflict_do_nothing(index_elements=["family_id", "category", "name"]))
    tag = db.scalar(select(Subcategory.id).where(Subcategory.family_id == parent.family_id,
        Subcategory.category == "finance", Subcategory.name == tag_name))
    if fee is None:
        fee = Transaction(family_id=parent.family_id, transfer_fee_for_id=parent.id, source_kind="transfer_fee",
                          type="expense", category="finance", repeat="none")
        db.add(fee)
    fee.member_id = parent.member_id
    fee.account_id = parent.account_id
    fee.to_account_id = None
    fee.amount = amount
    fee.date = parent.date
    fee.time = parent.time
    fee.subcategory_id = tag
    fee.note = None


def delete(db: Session, actor: Member, tx_id: uuid.UUID) -> None:
    """حذف: مدیر هر تراکنش خانواده؛ عضو فقط تراکنش خودش."""
    delete_uncommitted(db, actor, tx_id)
    db.commit()


def mark_occurrence(db: Session, actor: Member, tx_id: uuid.UUID, due_date: _date | None) -> None:
    """ثبت رسیدگی توسط صاحب تراکنش یا مدیر، بدون ثبت پرداخت دوباره."""
    if due_date is None:
        raise AppError("INVALID_DATE", "تاریخ سررسید نامعتبر است.", 422)
    row = _recurring_row(db, actor, tx_id)
    if row is not None:
        _require_source_access(actor, row)
    if row is None or row.repeat == "none":
        raise AppError("NOT_FOUND", "تراکنش تکرارشونده یافت نشد.", 404)
    key = due_date.isoformat()
    occ = list(row.handled_occurrences or [])
    if key not in occ:
        occ.append(key)
        row.handled_occurrences = occ  # بازتخصیص لیست تازه تا تغییر JSONB ردیابی شود
        db.commit()


# ── عکس‌های تراکنش ───────────────────────────────────────────
def _check_payment_account(
    db: Session,
    actor: Member,
    values: dict,
    require_balance: bool,
    *,
    replacing: Transaction | None = None,
) -> None:
    if not is_admin(actor) and values["member_id"] != actor.id:
        raise AppError("FORBIDDEN", "نمی‌توانید تراکنش را به عضو دیگری نسبت دهید.", 403)
    account_id = values["account_id"]
    if account_id is None:
        if (
            require_balance
            and db.scalar(
                select(Account.id)
                .where(
                    Account.family_id == actor.family_id,
                    Account.member_id == actor.id,
                )
                .limit(1)
            )
            is not None
        ):
            raise AppError("ACCOUNT_REQUIRED", "حساب پرداخت یا دریافت را انتخاب کنید.", 422)
        return
    ids = {account_id}
    if values["to_account_id"] is not None:
        ids.add(values["to_account_id"])
    rows = list(
        db.scalars(
            select(Account)
            .where(
                Account.family_id == actor.family_id,
                Account.id.in_(ids),
            )
            .order_by(Account.id)
            .with_for_update()
        )
    )
    account = next((row for row in rows if row.id == account_id), None)
    owner_id = replacing.member_id if replacing is not None and is_admin(actor) else actor.id
    if account is None or account.member_id != owner_id:
        raise AppError("ACCOUNT_FORBIDDEN", "فقط حساب‌های خودتان قابل انتخاب‌اند.", 403)
    if not require_balance or values["type"] == "income":
        return
    transactions = db.scalars(
        select(Transaction).where(
            Transaction.family_id == actor.family_id,
            or_(Transaction.account_id == account_id, Transaction.to_account_id == account_id),
        )
    )
    balance = account.initial_balance
    for transaction in transactions:
        if replacing is not None and (transaction.id == replacing.id or transaction.transfer_fee_for_id == replacing.id):
            continue
        if transaction.account_id == account_id:
            balance += transaction.amount if transaction.type == "income" else -transaction.amount
        if transaction.type == "transfer" and transaction.to_account_id == account_id:
            balance += transaction.amount
    if balance < values["amount"] + Decimal(values.get("transfer_fee_rial") or 0) / 10:
        raise AppError("INSUFFICIENT_BALANCE", "موجودی این حساب برای مبلغ واردشده کافی نیست.", 409)


def _recurring_row(db: Session, actor: Member, tx_id: uuid.UUID) -> Transaction:
    query = select(Transaction).where(
        Transaction.id == tx_id, Transaction.family_id == actor.family_id
    )
    if not is_admin(actor):
        query = query.where(Transaction.member_id == actor.id)
    row = db.scalar(query.with_for_update())
    if row is None:
        raise AppError("NOT_FOUND", "تراکنش تکرارشونده یافت نشد.", 404)
    _require_source_access(actor, row)
    return row


def _schedule_dates(row: Transaction):
    from datetime import timedelta

    import jdatetime

    if row.repeat == "none":
        return
    start = jdatetime.date.fromgregorian(date=row.recurring_start_date or row.date)
    for n in range(0 if row.recurring_start_date else 1, 1201):
        if row.repeat == "weekly":
            due = start.togregorian() + timedelta(days=7 * n)
        else:
            months = start.year * 12 + start.month - 1 + (n if row.repeat == "monthly" else 12 * n)
            year, month = divmod(months, 12)
            month += 1
            if not 1 <= year <= 9377:
                return
            day = start.day
            while True:
                try:
                    due = jdatetime.date(year, month, day).togregorian()
                    break
                except ValueError:
                    day -= 1
                    if day < 1:
                        return
        if row.repeat_end is not None and due > row.repeat_end:
            break
        yield due


def update_recurring(
    db: Session, actor: Member, tx_id: uuid.UUID, req: RecurringUpdate
) -> Transaction:
    row = _recurring_row(db, actor, tx_id)
    if row.repeat == "none" or row.source_kind is not None:
        raise AppError("NOT_FOUND", "تراکنش تکرارشونده یافت نشد.", 404)
    if row.recurring_revision != req.revision:
        raise AppError("RECURRING_CONFLICT", "برنامهٔ تکرار تغییر کرده؛ اطلاعات را تازه کنید.", 409)
    if req.repeat not in _REPEATS or (req.repeat != "none" and req.start_date < today_tehran()):
        raise AppError("INVALID_DATE", "موعد بعدی را از امروز به بعد انتخاب کنید.", 422)
    prepared = _prepare(
        db,
        actor.family_id,
        TransactionWrite(
            member_id=str(row.member_id),
            type=row.type,
            amount=req.amount,
            category=req.category,
            date=req.start_date,
            note=req.note,
            account_id=str(row.account_id) if row.account_id else None,
            to_account_id=str(row.to_account_id) if row.to_account_id else None,
            repeat=req.repeat,
            repeat_end=req.repeat_end,
        ),
    )
    # Only future plan columns change. The first actual transaction and all paid rows stay intact.
    row.recurring_amount = prepared["amount"]
    row.recurring_category = prepared["category"]
    row.recurring_note = prepared["note"] or ""
    row.recurring_start_date = req.start_date
    row.repeat = req.repeat
    row.repeat_end = req.repeat_end if req.repeat != "none" else None
    row.recurring_revision += 1
    db.commit()
    db.refresh(row)
    return row


def settle_occurrence(
    db: Session, actor: Member, tx_id: uuid.UUID, req: OccurrenceSettle
) -> Transaction:
    row = _recurring_row(db, actor, tx_id)
    existing = db.scalar(
        select(Transaction).where(
            Transaction.family_id == actor.family_id,
            Transaction.recurring_source_id == row.id,
            Transaction.recurring_due_date == req.due_date,
        )
    )
    if existing is not None:
        return existing
    if row.recurring_revision != req.revision:
        raise AppError("RECURRING_CONFLICT", "برنامهٔ تکرار تغییر کرده؛ اطلاعات را تازه کنید.", 409)
    pending = (
        day
        for day in _schedule_dates(row)
        if day.isoformat() not in (row.handled_occurrences or [])
    )
    available = (
        req.due_date in pending
        if req.transaction is not None
        else next(pending, None) == req.due_date
    )
    if not available:
        raise AppError(
            "OCCURRENCE_UNAVAILABLE", "این نوبت دیگر قابل تسویه نیست؛ برنامه را تازه کنید.", 409
        )
    source = req.transaction
    if source is not None and (
        source.type != row.type
        or source.repeat != "none"
        or source.date is None
        or source.date > today_tehran()
    ):
        raise AppError("INVALID_OCCURRENCE", "نوع نوبت و تاریخ پرداخت را بررسی کنید.", 422)
    values = _prepare(
        db,
        actor.family_id,
        TransactionWrite(
            member_id=str(row.member_id),
            type=row.type,
            amount=source.amount if source else row.recurring_amount or row.amount,
            category=source.category if source else row.recurring_category or row.category,
            date=source.date if source else today_tehran(),
            time=source.time if source else None,
            note=source.note
            if source
            else row.recurring_note
            if row.recurring_note is not None
            else row.note,
            account_id=source.account_id if source else req.account_id,
            to_account_id=source.to_account_id if source else req.to_account_id,
            subcategory_id=source.subcategory_id
            if source
            else (
                str(row.subcategory_id)
                if row.subcategory_id is not None
                and (row.recurring_category or row.category) == row.category
                else None
            ),
            repeat="none",
            transfer_fee_method=source.transfer_fee_method if source else row.transfer_fee_method,
        ),
    )
    _check_payment_account(db, actor, values, True)
    payment = Transaction(
        family_id=actor.family_id,
        recurring_source_id=row.id,
        recurring_due_date=req.due_date,
        **values,
    )
    db.add(payment)
    db.flush()
    _sync_transfer_fee(db, payment)
    row.handled_occurrences = [*(row.handled_occurrences or []), req.due_date.isoformat()]
    db.commit()
    db.refresh(payment)
    return payment


def photos_for_transaction(
    db: Session, family_id: uuid.UUID, tx_id: uuid.UUID
) -> list[TransactionPhoto]:
    return list(
        db.scalars(
            select(TransactionPhoto)
            .where(
                TransactionPhoto.family_id == family_id,
                TransactionPhoto.transaction_id == tx_id,
            )
            .order_by(TransactionPhoto.created_at)
        )
    )


def _photo_permitted(db: Session, actor: Member, photo: TransactionPhoto) -> bool:
    """مجاز: مدیر، آپلودر، یا سازندهٔ تراکنش همان عکس."""
    transaction = db.execute(
        select(Transaction)
        .where(Transaction.id == photo.transaction_id, Transaction.family_id == actor.family_id)
        .limit(1)
    ).scalar_one_or_none()
    if transaction is None:
        return False
    _require_source_access(actor, transaction)
    return is_admin(actor) or photo.member_id == actor.id or transaction.member_id == actor.id


def add_photo(db: Session, actor: Member, tx_id: uuid.UUID, req: PhotoCreate) -> TransactionPhoto:
    transaction = db.execute(
        select(Transaction)
        .where(Transaction.id == tx_id, Transaction.family_id == actor.family_id)
        .limit(1)
    ).scalar_one_or_none()
    if transaction is None:
        raise AppError("NOT_FOUND", "تراکنش یافت نشد.", 404)
    _require_source_access(actor, transaction)
    if transaction.source_kind == "vehicle_service":
        raise AppError(
            "SOURCE_ATTACHMENT_UNAVAILABLE",
            "رسید سرویس خودرو را از بخش اسناد خانه ثبت و به خودرو وصل کنید.",
            422,
        )
    url = (req.url or "").strip()
    if len(url) < 10 or len(req.url or "") > 500:
        raise AppError("INVALID_URL", "نشانی تصویر نامعتبر است.", 422)
    caption = (req.caption or "").strip()
    if len(caption) > 100:
        raise AppError("INVALID_CAPTION", "توضیح تصویر بیش از حد بلند است.", 422)
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


def update_photo_caption(
    db: Session, actor: Member, photo_id: uuid.UUID, caption: str | None
) -> None:
    text = (caption or "").strip()
    if len(text) > 100:
        raise AppError("INVALID_CAPTION", "توضیح تصویر بیش از حد بلند است.", 422)
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
