"""تنظیمات «تشخیص تراکنش از پیامک» — رضایتِ به‌ازای هر حساب.

این ماژول عمداً از messaging.py جداست. آنجا «پیامک‌ها» است؛ اینجا «اجازه‌ها».
قاطی‌کردنشان یعنی تابعی که پیامک درج می‌کند بتواند اجازه هم بدهد.

سه قاعده‌ای که کل این فایل برای نگه‌داشتنشان نوشته شده:

۱) هیچ حساب یا کارتی اینجا ساخته نمی‌شود. کاربر فقط از میان حساب‌هایی که
   قبلاً در خانه‌یار ثبت کرده انتخاب می‌کند. هر تابعی که account_id می‌گیرد
   اول _owned_account را صدا می‌زند که ردیف را «داخل همین خانواده» پیدا کند
   وگرنه NOT_FOUND بدهد — نه اینکه بسازد.

۲) کیف‌پول پیامک ندارد. فعال‌کردن تشخیص روی kind='wallet' خطاست، نه یک
   کلیدِ بی‌اثر؛ کلیدِ بی‌اثر یعنی کاربر فکر کند چیزی روشن است که نیست.

۳) شماره‌ای که کاربر اضافه می‌کند verified=false می‌ماند و هیچ‌جا وانمود
   نمی‌شود تأیید شده است. مهم‌تر: خودِ «افزودن شماره» هیچ اجازه‌ای نمی‌دهد.
   شماره فقط می‌گوید «این منبع مجاز است»؛ اینکه چه چیزی بررسی شود را
   accounts.sms_enabled و sms_senders تعیین می‌کنند.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.account import Account
from app.models.family import Member
from app.models.messaging import SmsNumber, SmsSender

# سرشماره‌های بانکی ایران کوتاه و عددی‌اند (۶۰۰۰…، ۱۰۰۰…، ۳۰۰۰…) ولی بعضی
# اپراتورها نامِ حرفی هم می‌فرستند (BANKMELLAT). پس هر دو را می‌پذیریم و فقط
# فاصله و خط‌تیره را می‌شوییم. سخت‌گیری بیشتر یعنی کاربری که سرشماره‌اش
# قالب غیرمنتظره دارد اصلاً نتواند از قابلیت استفاده کند.
_SENDER_RE = re.compile(r"^[A-Za-z0-9+*#._-]{2,32}$")
_MAX_SENDERS_PER_ACCOUNT = 20
_MAX_NUMBERS_PER_MEMBER = 5


def _fa_digits_to_en(value: str) -> str:
    """ارقام فارسی/عربی → لاتین. کاربر ایرانی شماره را با کیبورد فارسی می‌زند."""
    out = []
    for ch in value:
        code = ord(ch)
        if 0x06F0 <= code <= 0x06F9:  # ۰-۹ فارسی
            out.append(chr(code - 0x06F0 + 48))
        elif 0x0660 <= code <= 0x0669:  # ٠-٩ عربی
            out.append(chr(code - 0x0660 + 48))
        else:
            out.append(ch)
    return "".join(out)


def normalize_sender(raw: str | None) -> str:
    """فرستنده را به شکل مقایسه‌پذیر درمی‌آورد (بدون فاصله/خط‌تیره/+، حروف کوچک).

    مقایسهٔ فرستنده باید «نرمال با نرمال» باشد وگرنه «+۹۸۲۱…» و «۹۸۲۱…» دو
    چیز متفاوت می‌شوند و کاربر نمی‌فهمد چرا پیامکش رد شد.

    «+» هم حذف می‌شود، نه فقط فاصله و خط‌تیره: اپراتور گاهی همان فرستنده را
    با +98 و گاهی بدون آن تحویل می‌دهد، و اگر + بماند این وعده روی کاغذ
    می‌ماند. شمارهٔ موبایلِ ۱۲رقمیِ 98… هم به شکل محلی 0… درمی‌آید تا با
    _valid_phone یک‌زبان باشد؛ سرشماره‌های کوتاه هرگز ۱۲ رقمی نیستند، پس
    این تبدیل به آن‌ها دست نمی‌زند.
    """
    s = _fa_digits_to_en((raw or "").strip())
    s = re.sub(r"[\s\-()+]", "", s)
    if len(s) == 12 and s.startswith("989") and s.isdigit():
        s = "0" + s[2:]
    return s.casefold()


def _valid_sender(raw: str | None) -> str:
    s = normalize_sender(raw)
    if not _SENDER_RE.fullmatch(s):
        raise AppError("INVALID_SENDER", "شمارهٔ فرستنده نامعتبر است.", 422)
    return s


def _valid_phone(raw: str | None) -> str:
    digits = re.sub(r"\D", "", _fa_digits_to_en(raw or ""))
    # ۰۹xxxxxxxxx یا ۹۸۹xxxxxxxxx یا ۹xxxxxxxxx → همه به ۰۹xxxxxxxxx
    if digits.startswith("98") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif len(digits) == 10 and digits.startswith("9"):
        digits = "0" + digits
    if not re.fullmatch(r"09\d{9}", digits):
        raise AppError("INVALID_PHONE", "شمارهٔ موبایل نامعتبر است.", 422)
    return digits


def _owned_account(db: Session, actor: Member, account_id: uuid.UUID) -> Account:
    """حسابِ «موجود» داخل همین خانواده؛ وگرنه NOT_FOUND. هرگز نمی‌سازد.

    مثل accounts.update: مدیر به هر حساب خانواده دسترسی دارد، عضو فقط به
    حساب خودش.
    """
    stmt = select(Account).where(
        Account.id == account_id, Account.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(Account.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)
    return row


# ── فعال/غیرفعال‌کردن تشخیص برای یک حساب ────────────────────
def set_enabled(
    db: Session, actor: Member, account_id: uuid.UUID, enabled: bool | None
) -> Account:
    if enabled is None:
        raise AppError("INVALID_VALUE", "وضعیت فعال‌سازی مشخص نیست.", 422)
    row = _owned_account(db, actor, account_id)
    if enabled and row.kind != "bank":
        raise AppError(
            "SMS_NOT_APPLICABLE",
            "تشخیص از پیامک فقط برای حساب بانکی/کارت معنا دارد.",
            422,
        )
    row.sms_enabled = bool(enabled)
    db.commit()
    db.refresh(row)
    return row


def enabled_accounts(db: Session, family_id: uuid.UUID) -> list[Account]:
    """حساب‌های فعالِ خانواده. مبنای «دروازهٔ ورودی» در messaging.py."""
    return list(
        db.execute(
            select(Account).where(
                Account.family_id == family_id, Account.sms_enabled.is_(True)
            )
        ).scalars()
    )


# ── فرستنده‌های مجازِ هر حساب ───────────────────────────────
def list_senders(db: Session, family_id: uuid.UUID) -> list[SmsSender]:
    return list(
        db.execute(
            select(SmsSender)
            .where(SmsSender.family_id == family_id)
            .order_by(SmsSender.created_at.asc())
        ).scalars()
    )


def add_sender(
    db: Session, actor: Member, account_id: uuid.UUID, sender: str | None
) -> SmsSender:
    account = _owned_account(db, actor, account_id)
    value = _valid_sender(sender)

    existing = db.execute(
        select(SmsSender).where(
            SmsSender.account_id == account.id, SmsSender.sender == value
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing  # idempotent: افزودن دوبارهٔ همان سرشماره خطا نیست

    count = len(
        db.execute(
            select(SmsSender.id).where(SmsSender.account_id == account.id)
        ).all()
    )
    if count >= _MAX_SENDERS_PER_ACCOUNT:
        raise AppError("TOO_MANY_SENDERS", "تعداد فرستنده‌های این حساب پر است.", 422)

    row = SmsSender(family_id=actor.family_id, account_id=account.id, sender=value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def remove_sender(db: Session, actor: Member, sender_id: uuid.UUID) -> None:
    row = db.execute(
        select(SmsSender).where(
            SmsSender.id == sender_id, SmsSender.family_id == actor.family_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "فرستنده یافت نشد.", 404)
    # مجوز روی حسابِ صاحبِ این فرستنده سنجیده می‌شود، نه روی خودِ ردیف.
    _owned_account(db, actor, row.account_id)
    db.delete(row)
    db.commit()


# ── شماره‌های مجازِ عضو ─────────────────────────────────────
def list_numbers(db: Session, member_id: uuid.UUID) -> list[SmsNumber]:
    """شماره‌های «اضافه»ی عضو. شمارهٔ ثبت‌نام اینجا نیست (روی members است)."""
    return list(
        db.execute(
            select(SmsNumber)
            .where(SmsNumber.member_id == member_id)
            .order_by(SmsNumber.created_at.asc())
        ).scalars()
    )


def add_number(
    db: Session, actor: Member, phone: str | None, label: str | None
) -> SmsNumber:
    value = _valid_phone(phone)

    # شمارهٔ ثبت‌نام از قبل مجاز است؛ افزودنش دوباره فقط کاربر را گیج می‌کند.
    if normalize_sender(getattr(actor, "phone", "")) == normalize_sender(value):
        raise AppError(
            "ALREADY_PRIMARY", "این همان شمارهٔ ثبت‌نام شماست و از قبل مجاز است.", 422
        )

    existing = db.execute(
        select(SmsNumber).where(
            SmsNumber.member_id == actor.id, SmsNumber.phone == value
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    count = len(
        db.execute(select(SmsNumber.id).where(SmsNumber.member_id == actor.id)).all()
    )
    if count >= _MAX_NUMBERS_PER_MEMBER:
        raise AppError("TOO_MANY_NUMBERS", "تعداد شماره‌های مجاز پر است.", 422)

    row = SmsNumber(
        family_id=actor.family_id,
        member_id=actor.id,
        phone=value,
        label=(label or "").strip()[:30],
        verified=False,  # هنوز هیچ کدِ تأییدی نداریم؛ UI باید صادق بماند
        active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def set_number_active(
    db: Session, actor: Member, number_id: uuid.UUID, active: bool
) -> SmsNumber:
    row = db.execute(
        select(SmsNumber).where(
            SmsNumber.id == number_id, SmsNumber.member_id == actor.id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "شماره یافت نشد.", 404)
    row.active = bool(active)
    db.commit()
    db.refresh(row)
    return row


def remove_number(db: Session, actor: Member, number_id: uuid.UUID) -> None:
    row = db.execute(
        select(SmsNumber).where(
            SmsNumber.id == number_id, SmsNumber.member_id == actor.id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "شماره یافت نشد.", 404)
    db.delete(row)
    db.commit()


def reset_account(db: Session, actor: Member, account_id: uuid.UUID) -> None:
    """بازنشانی کاملِ تنظیماتِ تشخیصِ یک حساب (بند ۲۴).

    حساب و تراکنش‌ها دست‌نخورده می‌مانند؛ فقط رضایت و فرستنده‌ها پاک می‌شوند.
    """
    account = _owned_account(db, actor, account_id)
    for row in db.execute(
        select(SmsSender).where(SmsSender.account_id == account.id)
    ).scalars():
        db.delete(row)
    account.sms_enabled = False
    db.commit()
