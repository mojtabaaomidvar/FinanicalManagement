"""خطاهای برنامه با کد پایدار + وضعیت HTTP.

کدها پایدارند تا فرانت بتواند بدون تکیه بر متن پیام، خطا را نگاشت کند
(جایگزین RPC_ERROR_MAP سمت کلاینت).
"""

from __future__ import annotations


class AppError(Exception):
    """خطای قابل‌ارائه به کلاینت با کد پایدار و پیام فارسی."""

    def __init__(self, code: str, message: str, http_status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


# ── خطاهای پرکاربرد (توسعه در فازهای بعد) ─────────────────
class Unauthorized(AppError):
    def __init__(self, message: str = "نشست نامعتبر یا منقضی است.") -> None:
        super().__init__("UNAUTHORIZED", message, 401)


class Forbidden(AppError):
    def __init__(self, message: str = "دسترسی مجاز نیست.") -> None:
        super().__init__("FORBIDDEN", message, 403)


class NotFound(AppError):
    def __init__(self, message: str = "یافت نشد.") -> None:
        super().__init__("NOT_FOUND", message, 404)


class RateLimited(AppError):
    def __init__(self, message: str = "تعداد تلاش‌ها زیاد است؛ بعداً دوباره تلاش کنید.") -> None:
        super().__init__("RATE_LIMITED", message, 429)


class Validation(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 422)
