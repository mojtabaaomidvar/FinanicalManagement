"""چرخهٔ حیات کدِ یک‌بارمصرف + پرچم‌های پیکربندی عمومی (otp_enabled / dev_mode).

مصرفِ کد از همان گیتِ ضد brute-force (`attempts`) رد می‌شود؛ یعنی خطاهای کد و
خطاهای رمز در یک شمارنده و یک پنجره جمع می‌شوند.

## سه تغییرِ ۲۰۲۶-۰۹-۲۷ (همراهِ مهاجرتِ `0008`)

**۱) کد دیگر خام ذخیره نمی‌شود.** ستون `code_hash` است و مقدارش
HMAC-SHA256ِ فلفل‌خوردهٔ کد. کدِ یک‌بارمصرف عملاً یک اعتبارنامه است و §۵.۱۱
ذخیرهٔ برگشت‌پذیر را منع می‌کند. فلفل از همان زنجیرهٔ `ratelimit._salt()` می‌آید
(`RATE_LIMIT_SALT` → `FILE_SIGNING_SECRET` → نمکِ درون‌فرایندی + هشدار). حالتِ
آخر یعنی با هر ری‌استارت کدهای در جریان بی‌اثر می‌شوند — پرهزینه نیست (کاربر
دوباره درخواست می‌دهد) و fail-safe است، نه fail-open.

**۲) کد «هدف» دارد.** پیش از این `insert_otp` همهٔ کدهای یک شماره را پاک
می‌کرد و `consume_otp` هر کدی را می‌پذیرفت. پس اگر مسیرِ بازیابیِ رمز روی همین
جدول ساخته می‌شد، کدی که برای *ورود* فرستاده شده بود رمز را عوض می‌کرد
(purpose confusion). حالا درج و مصرف، هر دو به `purpose` مقیدند.

**۳) ماشهٔ خاموشِ `otp_enabled` مهار شد.** هیچ کدی در بک‌اند این پرچم را
نمی‌نویسد؛ تنها راهِ روشن‌کردنش SQLِ دستی روی تولید است. تا دیروز اگر کسی این
کار را می‌کرد، `consume_otp` شروع می‌کرد به طلبِ کد در حالی که مسیرِ درخواست
هنوز `OTP_API_ONLY` می‌داد → **همهٔ کاربران از ورود می‌افتادند**. حالا
`is_otp_enabled` تا وقتی راهِ تحویلی نباشد (`sms.is_configured()`) پرچم را
نادیده می‌گیرد، و مسیرِ درخواست هم با درگاهِ پیکربندی‌شده واقعاً پیامک می‌فرستد.
پس دو حالتِ ممکن باقی می‌ماند و هر دو سازگارند: «کد نمی‌خواهیم» یا
«کد می‌خواهیم و می‌توانیم بفرستیم».

## چرا `verify_and_consume` جدا از `consume_otp`
`consume_otp` وقتی OTP خاموش است **بی‌صدا رد می‌شود** — که برای ورود درست است
(کد بخشِ اختیاریِ جریان است). ولی برای بازیابیِ رمز مرگ‌آور است: یعنی هرکسی
می‌توانست رمزِ هرکسی را بی‌هیچ کدی عوض کند. پس مسیرِ §۹.۵ از
`verify_and_consume` استفاده می‌کند که **بی‌قید‌و‌شرط** بررسی می‌کند.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.auth import PURPOSE_LOGIN, AuthAttempt, OtpCode
from app.models.settings import AppSetting
from app.services import attempts, ratelimit, sms
from app.services.clock import utcnow

logger = logging.getLogger(__name__)

# فاصلهٔ اجباری بین دو درخواستِ کد برای یک شماره.
_COOLDOWN_SECONDS = 60

# ردیف‌های کهنه‌تر از این با هر درج جارو می‌شوند.
_RETENTION = timedelta(hours=1)

_PEPPER_WARNED = False
_PROCESS_PEPPER = secrets.token_bytes(32)


def _pepper() -> bytes:
    """فلفلِ HMACِ کد — هم‌زنجیره با `ratelimit._salt()`."""
    global _PEPPER_WARNED

    configured = settings.rate_limit_salt or settings.file_signing_secret
    if configured:
        return configured.encode("utf-8")

    if not _PEPPER_WARNED:
        logger.warning(
            "RATE_LIMIT_SALT و FILE_SIGNING_SECRET هر دو خالی‌اند؛ فلفلِ کدِ "
            "یک‌بارمصرف درون‌فرایندی است و با ری‌استارت، کدهای در جریان بی‌اثر می‌شوند."
        )
        _PEPPER_WARNED = True
    return _PROCESS_PEPPER


def hash_code(code: str) -> str:
    """HMAC-SHA256ِ کد (۶۴ هگز). کدِ خام هیچ‌جا ذخیره نمی‌شود."""
    return hmac.new(_pepper(), code.encode("utf-8"), hashlib.sha256).hexdigest()


def _app_settings(db: Session) -> AppSetting | None:
    return db.get(AppSetting, 1)


def is_otp_enabled(db: Session) -> bool:
    """آیا ورود باید کدِ پیامکی هم بخواهد؟

    شرطِ دومْ مهارِ ماشهٔ خاموش است: پرچمِ روشن بی‌درگاهِ پیامک یعنی قفلِ همگانی،
    پس در آن حالت پرچم نادیده گرفته می‌شود (fail-safe).
    """
    row = _app_settings(db)
    if not (row and row.otp_enabled):
        return False
    if sms.is_configured() or is_dev_mode(db):
        return True
    logger.warning(
        "otp_enabled روشن است ولی درگاه پیامک پیکربندی نشده؛ برای جلوگیری از "
        "قفل‌شدنِ ورود، پرچم نادیده گرفته شد."
    )
    return False


def is_dev_mode(db: Session) -> bool:
    row = _app_settings(db)
    return bool(row.dev_mode) if row else False


def generate_code() -> str:
    """کد ۶ رقمی تصادفی امن (با صفر پیشوند)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def insert_otp(
    db: Session,
    phone: str,
    code: str,
    *,
    purpose: str = PURPOSE_LOGIN,
    ttl_seconds: int | None = None,
) -> None:
    """درجِ کدِ تازه.

    کدهای پیشینِ **همین شماره و همین هدف** حذف می‌شوند (یک کدِ زندهٔ فعال در هر
    جریان)، و هر ردیفِ کهنه‌تر از یک ساعت — با هر هدفی — جارو می‌شود. حذف عمداً
    به `purpose` مقید است تا جریانِ ورود و جریانِ بازیابی کدِ یکدیگر را نخورند.
    """
    ttl = ttl_seconds or settings.otp_ttl_seconds
    db.execute(
        delete(OtpCode).where(
            or_(
                and_(OtpCode.phone == phone, OtpCode.purpose == purpose),
                OtpCode.created_at < utcnow() - _RETENTION,
            )
        )
    )
    db.add(
        OtpCode(
            phone=phone,
            code_hash=hash_code(code),
            purpose=purpose,
            expires_at=utcnow() + timedelta(seconds=ttl),
        )
    )
    db.commit()


def in_cooldown(
    db: Session,
    phone: str,
    *,
    purpose: str = PURPOSE_LOGIN,
    seconds: int = _COOLDOWN_SECONDS,
) -> bool:
    """آیا برای این شماره/هدف تازگی کدی صادر شده؟

    عمداً `bool` برمی‌گرداند و خطا **نمی‌دهد**: در مسیرِ §۹.۵ باید بی‌صدا بماند،
    چون «۴۲۹ فقط برای شماره‌های ثبت‌شده» خودش اوراکلِ شمارشِ حساب است.
    """
    row = db.execute(
        select(OtpCode.id)
        .where(
            OtpCode.phone == phone,
            OtpCode.purpose == purpose,
            OtpCode.created_at > utcnow() - timedelta(seconds=seconds),
        )
        .limit(1)
    ).first()
    return row is not None


def request_otp(db: Session, phone: str, *, ip: str = "unknown") -> str | None:
    """درخواستِ کدِ ورود.

    سه حالت:
    * `dev_mode` روشن → کد در پاسخ برمی‌گردد (فقط توسعه).
    * درگاهِ پیامک پیکربندی شده → کد پیامک می‌شود و پاسخ `None` است.
    * هیچ‌کدام → `OTP_API_ONLY`؛ صدورِ کد بی‌راهِ تحویل بی‌معنی است.
    """
    # سقفِ per-IP پیش از هر بررسیِ دیگر: حتی همین «رد شدن» هم نباید بی‌نهایت بار
    # قابلِ فراخوانی باشد (رفعِ #۱۵).
    ratelimit.hit(db, "otp_request", ip, limit=settings.rl_otp_request_per_ip)

    dev = is_dev_mode(db)
    if not dev and not sms.is_configured():
        raise AppError("OTP_API_ONLY", "درخواست کد فقط از سرویس پیامک مجاز است.", 403)

    if in_cooldown(db, phone):
        raise AppError("TOO_SOON", "کمی صبر کنید و دوباره درخواست دهید.", 429)

    code = generate_code()
    insert_otp(db, phone, code, purpose=PURPOSE_LOGIN)

    if sms.is_configured():
        sms.deliver_code(phone, code, purpose=PURPOSE_LOGIN)

    # در تولید کد هرگز از API برنمی‌گردد (رفع D-2).
    return code if dev else None


def verify_and_consume(db: Session, phone: str, code: str | None, *, purpose: str) -> None:
    """بررسی و مصرفِ کد — **بی‌قید‌و‌شرط**، مستقل از پرچمِ `otp_enabled`.

    خطای نامعتبر پیش از raise ثبت و commit می‌شود تا شمارشِ ضد brute-force با
    rollback از بین نرود.
    """
    attempts.assert_not_locked(db, phone)

    row: OtpCode | None = None
    if code:
        row = db.execute(
            select(OtpCode)
            .where(
                OtpCode.phone == phone,
                OtpCode.purpose == purpose,
                OtpCode.code_hash == hash_code(code),
                OtpCode.used.is_(False),
                OtpCode.expires_at > utcnow(),
            )
            .order_by(OtpCode.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

    if row is None:
        attempts.record_attempt(db, phone, ok=False)  # شامل commit
        raise AppError("INVALID_OTP", "کد تأیید نادرست یا منقضی است.", 400)

    # مصرفِ کد با UPDATEِ شرطی، نه `row.used = True`. زیرِ READ COMMITTED دو
    # درخواستِ هم‌زمان با یک کد هر دو از SELECTِ بالا رد می‌شدند و هر دو موفق
    # می‌گشتند — در مسیرِ بازیابیِ رمز یعنی دو رمزِ متفاوت با یک کد. اینجا
    # فقط یکی `rowcount == 1` می‌گیرد.
    consumed = db.execute(
        update(OtpCode)
        .where(OtpCode.id == row.id, OtpCode.used.is_(False))
        .values(used=True)
    ).rowcount

    if not consumed:
        # بازندهٔ مسابقه باید همان خطای کدِ نامعتبر را ببیند، نه موفقیتِ دوم.
        attempts.record_attempt(db, phone, ok=False)  # شامل commit
        raise AppError("INVALID_OTP", "کد تأیید نادرست یا منقضی است.", 400)

    # پاک‌سازی خطاهای این شماره پس از موفقیت
    db.execute(
        delete(AuthAttempt).where(AuthAttempt.phone == phone, AuthAttempt.ok.is_(False))
    )
    db.commit()


def consume_otp(db: Session, phone: str, code: str | None) -> None:
    """مصرفِ کدِ **ورود**. اگر OTP خاموش باشد، بی‌بررسی رد می‌شود.

    ⚠️ همین «بی‌بررسی رد شدن» است که این تابع را برای مسیرهای حساس (مثل
    بازیابیِ رمز) نامناسب می‌کند — آن‌ها باید `verify_and_consume` را صدا بزنند.
    """
    if not is_otp_enabled(db):
        return  # OTP غیرفعال است
    verify_and_consume(db, phone, code, purpose=PURPOSE_LOGIN)
