"""گِیت مشترکِ ضد brute-force روی جدول auth_attempts.

این کمک‌تابع‌ها هستهٔ مشترکِ «قفل موقت» هستند که هم مسیر رمز عبور و هم مسیر OTP
از آن‌ها استفاده می‌کنند (همان پنجره و همان شمارنده — دقیقاً مثل schema.sql).

نکتهٔ حیاتیِ تراکنش (بهبود نسبت به نسخهٔ Postgres): تلاش ناموفق باید «commit» شود
تا با raiseِ خطای بعدی به عقب برنگردد. در نسخهٔ RPCِ قدیمی، auth_login پس از درج
تلاش، خطا می‌داد و کل تراکنش (شامل همان درج) rollback می‌شد؛ شمارش فقط به‌خاطر
فراخوانی جداگانهٔ auth_check_password کار می‌کرد. اینجا عمداً پیش از raise، commit
می‌کنیم تا شمارش صرف‌نظر از اندپوینت درست بماند.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.auth import AuthAttempt
from app.services.clock import utcnow


def recent_fail_count(db: Session, phone: str) -> int:
    """شمار تلاش‌های ناموفقِ این شماره در پنجرهٔ ضد brute-force."""
    window_start = utcnow() - timedelta(minutes=settings.brute_force_window_minutes)
    stmt = (
        select(func.count())
        .select_from(AuthAttempt)
        .where(
            AuthAttempt.phone == phone,
            AuthAttempt.ok.is_(False),
            AuthAttempt.created_at > window_start,
        )
    )
    return int(db.execute(stmt).scalar_one())


def assert_not_locked(db: Session, phone: str) -> None:
    """اگر شمار خطاها به سقف رسیده باشد، TOO_MANY_ATTEMPTS."""
    if recent_fail_count(db, phone) >= settings.brute_force_max_fails:
        raise AppError(
            "TOO_MANY_ATTEMPTS",
            "تعداد تلاش‌های ناموفق زیاد است؛ کمی بعد دوباره تلاش کنید.",
            429,
        )


def record_attempt(db: Session, phone: str, ok: bool) -> None:
    """ثبت یک تلاش + خانه‌تکانی؛ در همین‌جا commit می‌شود تا پایدار بماند.

    - موفق: همهٔ تلاش‌های ناموفقِ این شماره پاک می‌شوند (کاربری که چند بار اشتباه
      زده و بعد درست وارد شده، در پنجرهٔ ۱۵دقیقه‌ای گیر نیفتد).
    - همیشه: تلاش‌های قدیمی‌تر از ۱ روز پاک می‌شوند.
    - اگر همین فراخوانی تغییرات دیگری (مثل ارتقای هش رمز) در نشست معلق داشته باشد،
      این commit آن‌ها را هم پایدار می‌کند.
    """
    db.add(AuthAttempt(phone=phone, ok=ok))
    if ok:
        db.execute(
            delete(AuthAttempt).where(
                AuthAttempt.phone == phone, AuthAttempt.ok.is_(False)
            )
        )
    db.execute(delete(AuthAttempt).where(AuthAttempt.created_at < utcnow() - timedelta(days=1)))
    db.commit()
