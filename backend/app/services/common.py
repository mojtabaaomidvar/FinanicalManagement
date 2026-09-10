"""کمک‌تابع‌های مشترکِ لایهٔ سرویس (فاز ۷)."""

from __future__ import annotations

import uuid

from app.core.errors import AppError


def to_uuid(value: object, code: str, message: str, status: int = 422) -> uuid.UUID:
    """رشته/شناسه → UUID؛ در صورت None یا قالبِ نامعتبر، خطای دامنه‌ایِ پایدار.

    RPCهای قدیمی به cast دیتابیس تکیه داشتند (شناسهٔ نامعتبر → خطای ۵۰۰ خام یا
    «not exists» → کد دامنه). اینجا صریحاً همان کدِ دامنه (مثلِ INVALID_MEMBER،
    INVALID_ACCOUNT_ID) را می‌دهیم تا نگاشتِ خطای کلاینت پایدار بماند.
    """
    if value is None:
        raise AppError(code, message, status)
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise AppError(code, message, status) from None


def to_uuid_opt(value: object, code: str, message: str, status: int = 422) -> uuid.UUID | None:
    """مثلِ to_uuid ولی None را عبور می‌دهد (فیلدهای اختیاری مثل account_id)."""
    if value is None or value == "":
        return None
    return to_uuid(value, code, message, status)
