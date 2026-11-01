"""درگاهِ پیامکِ خروجی — تنها راهِ تحویلِ کدِ یک‌بارمصرف به کاربر.

چرا این فایل تازه است: تا پیش از این بک‌اند **هیچ** فرستندهٔ پیامکی نداشت.
`SMS_PROVIDER/SMS_API_KEY/SMS_SENDER` فقط در `config.py` تعریف شده بودند و
هیچ‌جا خوانده نمی‌شدند؛ `services/messaging.py` هم سراسر «ورودی» است (خواندنِ
پیامکِ بانکی). پس §۹.۵ («بازیابیِ رمز با کدِ پیامکی») بی‌این درز شدنی نبود.

## قاعدهٔ خنثی‌بودن
تا وقتی `SMS_API_KEY` خالی است، `get_sender()` یک `NullSmsSender` برمی‌گرداند
که چیزی ارسال نمی‌کند و **هرگز خطا بالا نمی‌برد**. یعنی مخزن بی‌هیچ کلیدی قابلِ
اجرا و تست است، و فعال‌سازیِ تولید فقط با پرکردنِ `.env` انجام می‌شود — هیچ
کلیدی در کد یا در `.env.example` نوشته نمی‌شود.

## کلید در «مسیرِ» URL است — نه در کوئری
کاوه‌نگار آدرس را این‌طور می‌خواهد:
`https://api.kavenegar.com/v1/{API-KEY}/verify/lookup.json`
پس فیلترِ ردکشنِ `app/core/logging.py` که `?key=…` و `api_key=…` را ماسک
می‌کند، این شکل را **نمی‌گیرد**. دو مهار گذاشته شد: (۱) الگوی مسیرِ کاوه‌نگار
به همان فیلتر اضافه شد، (۲) اینجا هیچ آدرسی لاگ نمی‌شود و متنِ هر خطا پیش از
هر مصرفی از `_scrub` رد می‌شود — چون `httpx.HTTPStatusError` آدرسِ کامل را
داخلِ پیامِ خودش می‌گذارد.

## چرا `SmsDeliveryError` و نه `AppError`
خطای ارسال **هرگز** نباید به کلاینت برسد. در مسیرِ «فراموشیِ رمز» پاسخ باید
برای شمارهٔ ثبت‌شده و ثبت‌نشده بایت‌به‌بایت یکسان باشد (ضدِ شمارشِ حساب، §۹.۵)؛
اگر خطای درگاه بالا بیاید، خودش می‌شود اوراکل. پس این استثنا از جنسِ داخلی
است و `deliver_code()` آن را می‌خورد و فقط لاگ می‌کند.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from app.core.config import settings
from app.models.auth import PURPOSE_LOGIN, PURPOSE_RESET

log = logging.getLogger(__name__)

_KAVENEGAR = "kavenegar"
# درگاه‌هایی که آداپتورِ واقعی دارند. هر چیزِ دیگری «پیکربندی‌نشده» است، نه
# «پیکربندی‌شدهٔ خراب» — تفاوتش در `is_configured` توضیح داده شده.
_KNOWN_PROVIDERS = frozenset({_KAVENEGAR})
_BASE = "https://api.kavenegar.com/v1"

# متنِ پیامکِ «متنِ آزاد» (مسیرِ sms/send.json). هنگام استفاده از قالبِ
# verify/lookup این متن‌ها به‌کار نمی‌آیند، چون متن در پنلِ کاوه‌نگار است.
_MESSAGES: dict[str, str] = {
    PURPOSE_LOGIN: "کد ورود به خانه‌یار: {code}",
    PURPOSE_RESET: "کد بازیابی رمز خانه‌یار: {code}",
}
_MESSAGE_FALLBACK = "کد تأیید خانه‌یار: {code}"
_MESSAGE_TAIL = "این کد را در اختیار کسی نگذارید."


class SmsDeliveryError(Exception):
    """خطای ارسال — عمداً `AppError` نیست تا به کلاینت راه پیدا نکند."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _scrub(text: str) -> str:
    """کلیدِ API را از هر متنی که ممکن است لاگ شود پاک می‌کند."""
    key = settings.sms_api_key
    return text.replace(key, "***") if key else text


def mask_phone(phone: str) -> str:
    """فقط چهار رقمِ آخر در لاگ می‌ماند (§۵ — داده حساس در لاگ نه)."""
    tail = phone[-4:] if len(phone) >= 4 else "?"
    return f"***{tail}"


def _body(purpose: str, code: str) -> str:
    template = _MESSAGES.get(purpose, _MESSAGE_FALLBACK)
    return f"{template.format(code=code)}\n{_MESSAGE_TAIL}"


class SmsSender(Protocol):
    """درزِ ارسال. هر پیاده‌سازی فقط همین یک کار را می‌کند."""

    name: str

    def send_code(self, phone: str, code: str, *, purpose: str) -> None:
        """کد را می‌فرستد یا `SmsDeliveryError` می‌دهد."""
        ...


class NullSmsSender:
    """فرستندهٔ خنثی — وقتی هیچ کلیدی پیکربندی نشده.

    در توسعه کد را در لاگ می‌گذارد تا کار جلو برود؛ در تولید **نه**، چون
    §۵ می‌گوید دادهٔ حساس در لاگ نرود. پس روی سرورِ تولیدِ بی‌کلید، کد
    ساخته و ذخیره می‌شود ولی هیچ‌کس آن را نمی‌بیند — که دقیقاً همان
    «به‌درستی پیکربندی نشده» است، نه یک درِ پشتی.
    """

    name = "null"

    def send_code(self, phone: str, code: str, *, purpose: str) -> None:
        if settings.is_production:
            log.warning(
                "پیامک ارسال نشد: درگاه پیکربندی نشده است (purpose=%s, to=%s)",
                purpose,
                mask_phone(phone),
            )
            return
        log.info(
            "[توسعه] پیامک ارسال نشد؛ کد %s برای %s (purpose=%s)",
            code,
            mask_phone(phone),
            purpose,
        )


class KavenegarSender:
    """آداپتورِ کاوه‌نگار.

    دو مسیر دارد و ترجیح روی اولی است:

    * `verify/lookup.json` با `template` — راهِ درستِ کدِ یک‌بارمصرف در ایران:
      «پیامکِ خدماتی» است، پس فیلتر نمی‌شود، خطِ اختصاصی نمی‌خواهد و تحویلش
      مطمئن‌تر است.
    * `sms/send.json` با متنِ آزاد — فقط وقتی `SMS_TEMPLATE` خالی است.

    کاوه‌نگار هم کدِ وضعیتِ HTTP می‌دهد و هم `return.status` داخلِ بدنه؛ هر دو
    بررسی می‌شوند، چون در برخی خطاها HTTP همان ۲۰۰ می‌ماند.
    """

    name = _KAVENEGAR

    def send_code(self, phone: str, code: str, *, purpose: str) -> None:
        key = settings.sms_api_key
        if not key:
            raise SmsDeliveryError("کلید پیامک تنظیم نشده است")

        if settings.sms_template:
            path = "verify/lookup.json"
            params = {
                "receptor": phone,
                "token": code,
                "template": settings.sms_template,
            }
        else:
            path = "sms/send.json"
            params = {"receptor": phone, "message": _body(purpose, code)}
            if settings.sms_sender:
                params["sender"] = settings.sms_sender

        timeout = httpx.Timeout(settings.sms_timeout_seconds)
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(f"{_BASE}/{key}/{path}", data=params)
                res.raise_for_status()
                payload = res.json()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            detail = _scrub((e.response.text or "").strip()[:200])
            raise SmsDeliveryError(f"کاوه‌نگار {status} — {detail or '—'}") from e
        except httpx.HTTPError as e:
            raise SmsDeliveryError(f"اتصال برقرار نشد — {type(e).__name__}") from e
        except ValueError as e:
            raise SmsDeliveryError("پاسخ درگاه قابل خواندن نبود") from e

        ret = payload.get("return") if isinstance(payload, dict) else None
        status = ret.get("status") if isinstance(ret, dict) else None
        if status != 200:
            message = _scrub(str(ret.get("message", "—")) if isinstance(ret, dict) else "—")
            raise SmsDeliveryError(f"کاوه‌نگار status={status} — {message}")


def is_configured() -> bool:
    """آیا ارسالِ واقعیِ پیامک ممکن است؟

    مصرف‌کنندهٔ مهمش `services/otp.py` است: پرچمِ `otp_enabled` نباید بتواند
    وقتی هیچ راهِ تحویلی نیست، ورود را به کدِ پیامکی مشروط کند — وگرنه همهٔ
    کاربران از ورود می‌افتند.

    **نه فقط «کلید پر است» (۲۰۲۶-۰۹-۲۸).** نسخهٔ پیشین تنها خالی‌نبودنِ کلید را
    می‌سنجید، پس با یک `SMS_PROVIDER`ِ غلط‌نوشته (یا درگاهی که هنوز آداپتور
    ندارد) به‌علاوهٔ کلیدِ پر، این تابع «آری» می‌گفت در حالی که `get_sender()`
    فرستندهٔ خنثی می‌داد: کد ساخته می‌شد، کاربر «۲۰۰ خالی» می‌گرفت، و هیچ
    پیامکی نمی‌رفت — دقیقاً همان دروغی که `password_reset.request_reset`
    می‌گوید جلوش را گرفته است. حالا «ممکن است» یعنی *واقعاً* ممکن است.
    """
    return bool(settings.sms_api_key) and provider_name() in _KNOWN_PROVIDERS


def provider_name() -> str:
    """نامِ درگاهِ انتخاب‌شده؛ خالی (یا فقط فاصله) = پیش‌فرض."""
    return (settings.sms_provider or "").strip().lower() or _KAVENEGAR


def get_sender() -> SmsSender:
    """فرستندهٔ فعال. بی‌کلید یا درگاهِ ناشناس → خنثی؛ وگرنه آداپتورِ درگاه."""
    if not settings.sms_api_key:
        return NullSmsSender()
    provider = provider_name()
    if provider in _KNOWN_PROVIDERS:
        return KavenegarSender()
    log.error("درگاه پیامک ناشناخته است: %s — ارسال انجام نمی‌شود", provider)
    return NullSmsSender()


def deliver_code(phone: str, code: str, *, purpose: str) -> bool:
    """نقطهٔ ورودِ امن — **هرگز** خطا بالا نمی‌برد.

    این همان چیزی است که از `BackgroundTasks` صدا زده می‌شود، پس خطایش هیچ
    مصرف‌کننده‌ای ندارد جز لاگ. خروجیِ bool فقط برای تست است.
    """
    sender = get_sender()
    try:
        sender.send_code(phone, code, purpose=purpose)
        return True
    except SmsDeliveryError as e:
        log.warning(
            "ارسال پیامک ناموفق (provider=%s, purpose=%s, to=%s): %s",
            sender.name,
            purpose,
            mask_phone(phone),
            _scrub(e.reason),
        )
        return False
    except Exception as e:  # noqa: BLE001 — درگاهِ بیرونی نباید مسیر را بشکند
        # `str(e)` لاگ می‌شود نه فقط نامِ کلاس: استثناهای httpx (مثل
        # `InvalidURL`) آدرس را در پیامِ خودشان دارند و آدرسِ کاوه‌نگار کلید را
        # در *مسیر* دارد — پس اول `_scrub`. تراسِ `log.exception` هم از
        # `RedactingFormatter` رد می‌شود (تا ۲۰۲۶-۰۹-۲۸ نمی‌شد).
        log.exception(
            "خطای پیش‌بینی‌نشده در ارسال پیامک (provider=%s, purpose=%s): %s: %s",
            sender.name,
            purpose,
            type(e).__name__,
            _scrub(str(e)),
        )
        return False
