"""چرخهٔ حیات OTP + پرچم‌های پیکربندی عمومی (otp_enabled / dev_mode).

مصرف OTP (consume_otp) از همان گِیت ضد brute-force (attempts) استفاده می‌کند؛
یعنی خطاهای OTP و خطاهای رمز در یک شمارنده و یک پنجره جمع می‌شوند — دقیقاً مثل
_consume_otp در schema.sql.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.auth import AuthAttempt, OtpCode
from app.models.settings import AppSetting
from app.services import attempts
from app.services.clock import utcnow


def _app_settings(db: Session) -> AppSetting | None:
    return db.get(AppSetting, 1)


def is_otp_enabled(db: Session) -> bool:
    row = _app_settings(db)
    return bool(row.otp_enabled) if row else False


def is_dev_mode(db: Session) -> bool:
    row = _app_settings(db)
    return bool(row.dev_mode) if row else False


def generate_code() -> str:
    """کد ۶ رقمیِ تصادفیِ امن (با صفرِ پیشوند)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def insert_otp(db: Session, phone: str, code: str) -> None:
    """درج کد تازه؛ کدهای قبلیِ همین شماره و کدهای کهنه‌تر از ۱ ساعت حذف می‌شوند."""
    db.execute(
        delete(OtpCode).where(
            or_(OtpCode.phone == phone, OtpCode.created_at < utcnow() - timedelta(hours=1))
        )
    )
    db.add(
        OtpCode(
            phone=phone,
            code=code,
            expires_at=utcnow() + timedelta(seconds=settings.otp_ttl_seconds),
        )
    )
    db.commit()


def request_otp_dev(db: Session, phone: str) -> str:
    """درخواست کد در حالت توسعه (کد به کلاینت برمی‌گردد). در تولید OTP_API_ONLY.

    در تولید، کد فقط باید از مسیر ارسال پیامک سمت سرور (فاز ۸) درج شود.
    """
    if not is_dev_mode(db):
        raise AppError("OTP_API_ONLY", "درخواست کد فقط از سرویس پیامک مجاز است.", 403)

    # حداقل ۶۰ ثانیه فاصله بین درخواست‌ها
    too_soon = db.execute(
        select(OtpCode.id)
        .where(OtpCode.phone == phone, OtpCode.created_at > utcnow() - timedelta(seconds=60))
        .limit(1)
    ).first()
    if too_soon is not None:
        raise AppError("TOO_SOON", "کمی صبر کنید و دوباره درخواست دهید.", 429)

    code = generate_code()
    insert_otp(db, phone, code)
    return code


def consume_otp(db: Session, phone: str, code: str | None) -> None:
    """بررسی و مصرف کد OTP. اگر OTP خاموش باشد، بی‌بررسی رد می‌شود.

    قفل ضد brute-force و شمارنده مشترک با مسیر رمز است. خطای نامعتبر پیش از raise
    ثبت و commit می‌شود تا شمارش پایدار بماند.
    """
    if not is_otp_enabled(db):
        return  # OTP غیرفعال است

    attempts.assert_not_locked(db, phone)

    row: OtpCode | None = None
    if code:
        row = db.execute(
            select(OtpCode)
            .where(
                OtpCode.phone == phone,
                OtpCode.code == code,
                OtpCode.used.is_(False),
                OtpCode.expires_at > utcnow(),
            )
            .order_by(OtpCode.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

    if row is None:
        attempts.record_attempt(db, phone, ok=False)  # شامل commit
        raise AppError("INVALID_OTP", "کد تأیید نادرست یا منقضی است.", 400)

    row.used = True
    # پاک‌سازی خطاهای این شماره پس از موفقیت (مثل schema.sql)
    db.execute(
        delete(AuthAttempt).where(AuthAttempt.phone == phone, AuthAttempt.ok.is_(False))
    )
    db.commit()
