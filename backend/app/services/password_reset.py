"""بازیابیِ رمزِ فراموش‌شده (§9.5) — دو گام، بی‌هیچ اوراکلِ شمارشِ حساب.

جریان:
1. `request_reset(phone)` → **همیشه** موفق. اگر شماره عضوِ واقعی باشد، کدی با
   هدفِ `password_reset` درج و پیامک می‌شود؛ اگر نباشد، هیچ‌کاری نمی‌شود. پاسخ
   در هر دو حالت یکسان است.
2. `confirm_reset(phone, code, new_password)` → کد **بی‌قید‌و‌شرط** بررسی می‌شود،
   رمزِ تازه با Argon2id نشانده می‌شود، و **همهٔ** نشست‌های عضو باطل می‌شوند.

## چهار تصمیمِ امنیتیِ این فایل (هر کدام رفعِ یک نشتِ مشخص)

**۱) کول‌داون بی‌صداست.** `otp.in_cooldown` عمداً `bool` برمی‌گرداند و خطا
نمی‌دهد. اگر مثلِ مسیرِ ورود `TOO_SOON/429` می‌داد، شمارهٔ ثبت‌شده ۴۲۹ می‌گرفت و
ثبت‌نشده ۲۰۰ — یعنی خودِ محدودیتِ نرخ می‌شد ابزارِ شمارشِ حساب.

**۲) ارسال در پس‌زمینه است.** فراخوانیِ HTTPِ درگاه صدها میلی‌ثانیه طول می‌کشد و
**فقط** برای شماره‌های ثبت‌شده رخ می‌دهد؛ یعنی زمانِ پاسخ خودش یک کاناله جانبی
است. پس ارسال به صفِ پس‌از‌پاسخ می‌رود. سودِ دوم: درگاهِ کند اندپوینت را
هنگ نمی‌کند.

**۳) `verify_and_consume` نه `consume_otp`.** دومی وقتی `otp_enabled` خاموش است
بی‌بررسی رد می‌شود — روی این مسیر یعنی «هرکس رمزِ هرکس را عوض کند». بازیابی به
پرچمِ ورود هیچ ربطی ندارد و همیشه کد می‌خواهد.

**۴) `logout_all` نه `revoke_others`.** فرضِ بازیابی این است که رمزِ قبلی از
دستِ کاربر خارج شده؛ پس هر نشستِ بازِ دیگری هم مشکوک است. (`change_password`
برعکس، نشستِ جاریِ خودِ کاربر را نگه می‌دارد.)

## چرا خطاهای گامِ ۲ نشتی ندارند
شمارهٔ ثبت‌نشده هیچ کدی ندارد، پس بررسی شکست می‌خورد و همان
`INVALID_OTP/400` را می‌گیرد که شمارهٔ ثبت‌شده با کدِ غلط می‌گیرد — پاسخ
بایت‌به‌بایت یکسان. نه شرطِ اضافه‌ای لازم است و نه دروغی گفته می‌شود.
"""

from __future__ import annotations

import logging
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import hash_password
from app.models.auth import PURPOSE_RESET
from app.models.family import Member
from app.services import otp as otp_service
from app.services import ratelimit, sessions, sms

logger = logging.getLogger(__name__)

_MIN_PASSWORD = 8
_UNKNOWN_IP = "unknown"

# دو سطلِ جدا با یک سقفِ مشترک: کاربری که کد را چند بار اشتباه می‌زند نباید از
# «درخواستِ کدِ تازه» هم محروم شود.
_KIND_REQUEST = "password_reset"
_KIND_CONFIRM = "password_reset_confirm"


class TaskQueue(Protocol):
    """صفِ کارِ پس‌از‌پاسخ — همان شکلِ `fastapi.BackgroundTasks`.

    عمداً به‌جای وارد‌کردنِ `BackgroundTasks` یک پروتکلِ باریک تعریف شده تا این
    لایه به فریم‌ورک گره نخورد و در تست بتوان صفِ بدلی داد.
    """

    def add_task(self, func: object, /, *args: object, **kwargs: object) -> None: ...


def _member_by_phone(db: Session, phone: str) -> Member | None:
    return db.execute(select(Member).where(Member.phone == phone).limit(1)).scalar_one_or_none()


def is_available() -> bool:
    """آیا مسیرِ بازیابی روی این سرور کار می‌کند؟

    تکیه‌گاهِ تکِ دو مصرف‌کننده تا از هم نروند: گیتِ `request_reset` و پرچمی که
    `/auth/config` به کلاینت می‌دهد تا دکمهٔ «فراموشی رمز» را وقتی بی‌فایده است
    نشان ندهد. در توسعه بی‌کلید هم کار می‌کند، چون `NullSmsSender` کد را در لاگ
    می‌گذارد؛ در تولید بی‌کلید نه.
    """
    return sms.is_configured() or not settings.is_production


def request_reset(db: Session, phone: str, *, background: TaskQueue, ip: str = _UNKNOWN_IP) -> None:
    """گامِ ۱ — درخواستِ کد. هیچ‌وقت خبری از وجود/نبودِ شماره نمی‌دهد.

    تنها خطای ممکن `TOO_MANY_ATTEMPTS` (سقفِ per-IP) است که به شماره وابسته
    نیست، و در تولیدِ بی‌درگاه `SMS_NOT_CONFIGURED` که وضعیتِ سراسریِ سرور است —
    نه ویژگیِ این شماره. هر دو برای همهٔ شماره‌ها یکسان رخ می‌دهند.
    """
    ratelimit.hit(db, _KIND_REQUEST, ip, limit=settings.rl_password_reset_per_ip)

    # صداقت: روی تولیدِ بی‌کلید کد ساخته می‌شود ولی به دستِ کاربر نمی‌رسد. «۲۰۰
    # خالی» آنجا یعنی دروغ. این بررسی سراسری است و چیزی از شماره نمی‌گوید.
    if not is_available():
        logger.error("بازیابیِ رمز درخواست شد ولی درگاهِ پیامک پیکربندی نشده است.")
        raise AppError(
            "SMS_NOT_CONFIGURED",
            "سرویس پیامک در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
            503,
        )

    member = _member_by_phone(db, phone)
    if member is None or not member.password_hash:
        # دو حالتِ جدا، یک پاسخِ یکسان (همان ۲۰۰ِ خالی). لاگ برای رصدِ
        # پروب‌کردن می‌ماند و فقط چهار رقمِ آخرِ شماره را دارد.
        #
        #   • شمارهٔ ناشناس.
        #   • عضوی که **مدیر** ساخته و هنوز خودش ثبت‌نام نکرده، پس هیچ رمزی
        #     ندارد. «فراموشیِ رمز» یعنی رمزی داشته‌ای؛ اگر این‌جا برایش رمز
        #     بنشانیم، مسیرِ بازیابی می‌شود راهِ دومِ *ثبت‌نام* — و راهِ بدی
        #     هم هست: `add_member_by_manager` سطر را با `status='pending'`
        #     می‌سازد ولی `membership_state` پیش‌فرضِ `'active'` دارد، و
        #     `_ensure_can_login` تنها همین دومی را می‌سنجد. پس کاربر نشست
        #     می‌گرفت بی‌آنکه از `/auth/register` بگذرد: `status` تا ابد
        #     `pending` می‌ماند و `/auth/pre-registered` برای آن شماره همیشه
        #     `true` می‌گفت — یک اوراکلِ شمارشِ همیشه‌باز.
        logger.info(
            "بازیابیِ رمز بی‌اقدام برای %s (ناشناس یا بی‌رمز).", sms.mask_phone(phone)
        )
        return

    # وضعیتِ عضویت (`pending`/`rejected`) اینجا سد نمی‌شود: مرجعِ «حقِ ورود»
    # همان `auth._ensure_can_login` در زمانِ ورود است. بستنِ بازیابی برای عضوِ
    # در انتظار فقط یک بن‌بست می‌ساخت، بی‌هیچ سودِ امنیتی.
    if otp_service.in_cooldown(db, phone, purpose=PURPOSE_RESET):
        logger.info("بازیابیِ رمز در کول‌داون (%s) — کدِ تازه صادر نشد.", sms.mask_phone(phone))
        return

    code = otp_service.generate_code()
    otp_service.insert_otp(
        db,
        phone,
        code,
        purpose=PURPOSE_RESET,
        ttl_seconds=settings.password_reset_ttl_seconds,
    )
    # پس از بازگشتِ پاسخ اجرا می‌شود؛ `deliver_code` هرگز خطا بالا نمی‌برد.
    background.add_task(sms.deliver_code, phone, code, purpose=PURPOSE_RESET)


def confirm_reset(db: Session, phone: str, code: str, new_password: str, *, ip: str = _UNKNOWN_IP) -> None:
    """گامِ ۲ — بررسیِ کد و نشاندنِ رمزِ تازه.

    ترتیب عمدی است: سقفِ نرخ → طولِ رمز → مصرفِ کد. اگر رمزِ کوتاه پس از مصرفِ
    کد بررسی می‌شد، یک اشتباهِ تایپی کدِ درستِ کاربر را می‌سوزاند.
    """
    ratelimit.hit(db, _KIND_CONFIRM, ip, limit=settings.rl_password_reset_per_ip)

    if not new_password or len(new_password) < _MIN_PASSWORD:
        raise AppError("WEAK_PASSWORD", "رمز جدید باید حداقل ۸ کاراکتر باشد.", 422)

    # بی‌قید‌و‌شرط — مستقل از پرچمِ `otp_enabled`. شمارهٔ ثبت‌نشده هم از همین‌جا
    # با `INVALID_OTP` رد می‌شود، پس پاسخ‌ها یکسان می‌مانند.
    otp_service.verify_and_consume(db, phone, code, purpose=PURPOSE_RESET)

    member = _member_by_phone(db, phone)
    if member is None:
        # عملاً نارسیدنی: کدِ معتبرِ `password_reset` فقط برای عضوِ موجود درج
        # می‌شود. اگر عضو بینِ دو گام حذف شده باشد، پیامِ کد را می‌دهیم تا
        # حتی همین حالتِ نادر هم اوراکل نسازد.
        logger.warning("کدِ بازیابیِ معتبر ولی عضو یافت نشد (%s).", sms.mask_phone(phone))
        raise AppError("INVALID_OTP", "کد تأیید نادرست یا منقضی است.", 400)

    member.password_hash = hash_password(new_password)

    # اتمی عمدی: `logout_all` خودش commit می‌کند و همان commit تغییرِ رمزِ معلق را
    # هم پایدار می‌کند (همان اصطلاحِ مستندشده در `attempts.record_attempt`). اگر
    # اول رمز را commit می‌کردیم و ابطالِ نشست‌ها شکست می‌خورد، نشستِ دزدیده‌شده
    # با رمزِ تازه هم زنده می‌ماند — یعنی همان چیزی که بازیابی قرار بود ببندد.
    sessions.logout_all(db, member.id)
    logger.info("رمزِ عضو با کدِ پیامکی بازنشانی شد (%s).", sms.mask_phone(phone))
