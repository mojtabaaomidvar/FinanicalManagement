"""هستهٔ امنیت: هش رمز (Argon2id)، توکن نشست، و ارتقای هش‌های قدیمی.

تصمیم‌های قفل‌شده:
- هش رمز = Argon2id.
- هش‌های قدیمی (bcrypt یا legacy sha256) هنگام ورود موفق، به Argon2id ارتقا می‌یابند.
- توکن نشست = رشتهٔ opaque تصادفی؛ در دیتابیس فقط hash آن (SHA-256) ذخیره می‌شود
  (رفع D-3: توکن خام هرگز ذخیره نمی‌شود).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

# نمونهٔ واحد Argon2id با پارامترهای پیکربندی
_ph = PasswordHasher(
    time_cost=settings.argon2_time_cost,
    memory_cost=settings.argon2_memory_cost,
    parallelism=settings.argon2_parallelism,
)


# ── هش رمز ─────────────────────────────────────────────────
def hash_password(password: str) -> str:
    """هش تازهٔ Argon2id (خروجی با `$argon2id$` شروع می‌شود)."""
    return _ph.hash(password)


def verify_password(
    stored_hash: str,
    password: str,
    *,
    phone: str | None = None,
) -> tuple[bool, str | None]:
    """تأیید رمز در برابر هر یک از قالب‌های پشتیبانی‌شده.

    خروجی: (معتبر؟، هشِ_جدید_برای_ذخیره یا None).
    اگر هشِ جدید برنگردد یعنی نیازی به به‌روزرسانی نیست.

    قالب‌های پشتیبانی‌شده:
      * `$argon2id$...`  → قالب فعلی (در صورت نیاز rehash می‌شود)
      * `$2a/$2b/$2y$...` → bcrypt قدیمی → پس از تأیید به Argon2id ارتقا
      * ۶۴ کاراکتر hex    → legacy sha256(phone:password) → ارتقا به Argon2id
    """
    if not stored_hash:
        return False, None

    # ۱) Argon2id فعلی
    if stored_hash.startswith("$argon2"):
        try:
            _ph.verify(stored_hash, password)
        except (VerifyMismatchError, InvalidHashError):
            return False, None
        # اگر پارامترها تغییر کرده‌اند، هش را تازه کن
        if _ph.check_needs_rehash(stored_hash):
            return True, hash_password(password)
        return True, None

    # ۲) bcrypt قدیمی
    if stored_hash.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            ok = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
        except ValueError:
            return False, None
        return (True, hash_password(password)) if ok else (False, None)

    # ۳) legacy sha256(phone:password) — ۶۴ کاراکتر hex
    #    NOTE: قالب دقیق را پیش از مهاجرت با تابع _verify_password در schema.sql
    #    تطبیق دهید (ترتیب/جداکنندهٔ phone:password).
    if phone is not None and _looks_like_sha256_hex(stored_hash):
        candidate = hashlib.sha256(f"{phone}:{password}".encode("utf-8")).hexdigest()
        if hmac.compare_digest(candidate, stored_hash.lower()):
            return True, hash_password(password)
        return False, None

    return False, None


def _looks_like_sha256_hex(value: str) -> bool:
    if len(value) != 64:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


# ── توکن نشست ──────────────────────────────────────────────
def new_session_token() -> tuple[str, str]:
    """توکن خام (به کلاینت) و hash آن (برای ذخیره) را برمی‌گرداند.

    خروجی: (raw_token, token_hash). فقط `token_hash` در دیتابیس ذخیره شود.
    """
    raw = secrets.token_hex(settings.session_token_bytes)  # ۶۴ کاراکتر hex
    return raw, hash_token(raw)


def hash_token(raw_token: str) -> str:
    """هش SHA-256 توکن نشست برای ذخیره/جست‌وجو (زمان‌ثابت هنگام مقایسه)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def tokens_match(raw_token: str, stored_hash: str) -> bool:
    """مقایسهٔ زمان‌ثابتِ توکن خام با hash ذخیره‌شده."""
    return hmac.compare_digest(hash_token(raw_token), stored_hash)
