"""بررسی رمز «با قفل» — تنها مسیری که مصرف‌کننده‌های بیرونی باید از آن رد شوند.

چرا گِیت متمرکز؟ در نسخهٔ قدیمی، مهاجم با صداکردن مستقیم auth_login قفلِ
auth_check_password را دور می‌زد (حدس نامحدود + هزینهٔ هش روی سرور). اینجا هر مسیرِ
بررسی رمز از همین تابع می‌گذرد.

مهاجرت شفاف هش: هش‌های قدیمی bcrypt یا legacy sha256(phone:password) پس از تأیید
موفق، به Argon2id ارتقا می‌یابند (رفع D-2 سمت سرور).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.models.family import Member
from app.services import attempts


def check_password_gated(db: Session, phone: str, password: str) -> bool:
    """بررسی رمز با اعمال قفل ضد brute-force و ارتقای هش. خروجی: معتبر؟

    اگر شمار خطاها به سقف رسیده باشد، assert_not_locked خطای TOO_MANY_ATTEMPTS
    می‌دهد. در پایان، تلاش (موفق/ناموفق) ثبت و commit می‌شود.
    """
    attempts.assert_not_locked(db, phone)

    member = db.execute(
        select(Member).where(Member.phone == phone).limit(1)
    ).scalar_one_or_none()

    ok = False
    if member is not None and member.password_hash and password:
        ok, new_hash = verify_password(member.password_hash, password, phone=phone)
        if ok and new_hash:
            member.password_hash = new_hash  # ارتقا به Argon2id (با commit همین‌جا پایدار می‌شود)

    # ثبت تلاش (و در صورت موفقیت، پاک‌سازی خطاهای قبلی) — شامل commit
    attempts.record_attempt(db, phone, ok=ok)
    return ok
