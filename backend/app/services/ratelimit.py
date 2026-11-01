"""سقفِ نرخِ عمومیِ «پنجرهٔ ثابت» روی جدولِ `lookup_attempts` (§5.11).

# جایگاهِ این ماژول در برابرِ `attempts.py`
دو محورِ مستقل داریم و هر دو لازم‌اند:

| ماژول          | کلید   | چه چیزی را می‌بندد                               | اثرِ رسیدن به سقف |
|----------------|--------|--------------------------------------------------|-------------------|
| `attempts.py`  | شماره  | حدسِ رمزِ **یک حساب** (brute-force)               | قفلِ موقتِ حساب   |
| `ratelimit.py` | IP     | آزمودنِ **هزار حساب** از یک مبدأ (stuffing) و     | ۴۲۹ به آن مبدأ    |
|                |        | حدسِ کدِ ۶رقمیِ خانواده و سیلِ ثبت‌نام/OTP         |                   |

پس این ماژول جایگزینِ آن نیست؛ لایهٔ دومی است که محورِ «مبدأ» را می‌بندد.

# چرا IP خام ذخیره نمی‌شود
ستونِ `scope` فقط **HMAC-SHA256ِ نمک‌خوردهٔ** نشانی را نگه می‌دارد. علتش همان اصلِ
§5 است: «دادهٔ حساس را در لاگ/خطا/سرویسِ ثالث نگذار». جدولِ سقفِ نرخ نباید به
گزارشِ «چه کسی از کجا وارد شده» تبدیل شود. برای شمردن، فقط به برابریِ کلید نیاز
داریم نه به خودِ نشانی — و HMAC همان برابری را می‌دهد.
نمک از `RATE_LIMIT_SALT` می‌آید؛ اگر نبود از `FILE_SIGNING_SECRET`؛ و اگر هیچ‌کدام
نبود یک نمکِ تصادفیِ **درون‌فرایندی** ساخته و هشدار لاگ می‌شود. حالتِ آخر شمارنده
را با هر ری‌استارت صفر می‌کند ولی سقف را خاموش نمی‌کند (fail-safe، نه fail-open).

# چرا «پنجرهٔ ثابت» و نه توکن-باکِت
شمارشِ ردیف در یک بازهٔ زمانی با همان ایندکسی که از قبل هست انجام می‌شود، بی هیچ
حالتِ درون‌حافظه‌ای — پس با چند فرایند/کانتینر هم درست می‌ماند. مرزِ پنجره اجازهٔ
دو-برابر-شدنِ لحظه‌ای می‌دهد، که برای «ضدِ سیل» بی‌اهمیت است.

# ترتیبِ ثبت و بررسی (نکتهٔ حیاتی)
ابتدا **ثبت** می‌کنیم بعد **می‌شماریم**، و commit را پیش از هر raise انجام می‌دهیم —
درست مثل `attempts.record_attempt`. اگر برعکس بود، درخواستی که با ۴۲۹ رد می‌شود
خودش شمرده نمی‌شد و مهاجم می‌توانست با فشارِ پیوسته پنجره را همیشه زیرِ سقف نگه
دارد.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.auth import LookupAttempt
from app.services.clock import utcnow

logger = logging.getLogger(__name__)

_TOO_MANY = "تعداد درخواست‌ها از این دستگاه زیاد است؛ کمی بعد دوباره تلاش کنید."

# ردیف‌های کهنه‌تر از این با هر فراخوانی جارو می‌شوند (جدول رشد نکند).
_RETENTION = timedelta(hours=1)

_FALLBACK_WARNED = False

# نمکِ پشتیبان؛ یک‌بار در عمرِ فرایند ساخته می‌شود.
_PROCESS_SALT = secrets.token_bytes(32)


def _salt() -> bytes:
    """نمکِ HMAC — با ترتیبِ اولویت و هشدارِ یک‌بارهٔ حالتِ آخر."""
    global _FALLBACK_WARNED

    configured = settings.rate_limit_salt or settings.file_signing_secret
    if configured:
        return configured.encode("utf-8")

    if not _FALLBACK_WARNED:
        logger.warning(
            "RATE_LIMIT_SALT و FILE_SIGNING_SECRET هر دو خالی‌اند؛ نمکِ سقفِ نرخ "
            "درون‌فرایندی و موقت است و با ری‌استارت صفر می‌شود."
        )
        _FALLBACK_WARNED = True
    return _PROCESS_SALT


def scope_key(raw: str) -> str:
    """کلیدِ ناشناسِ سطل از یک شناسهٔ خام (IP، شماره، …). خروجی ۳۲ هگز."""
    digest = hmac.new(_salt(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:32]  # ۱۲۸ بیت — برای جلوگیری از برخورد کافی، نیمِ فضای ذخیره


def _prune(db: Session) -> None:
    db.execute(delete(LookupAttempt).where(LookupAttempt.created_at < utcnow() - _RETENTION))


def hit(
    db: Session,
    kind: str,
    raw_scope: str,
    *,
    limit: int,
    window_seconds: int | None = None,
    message: str | None = None,
) -> None:
    """یک درخواست را در سطلِ (kind, raw_scope) بشمار؛ اگر از سقف گذشت ۴۲۹ بده.

    `raw_scope` هش می‌شود و خامش هرگز ذخیره نمی‌گردد. `limit <= 0` یعنی «بی‌سقف»
    (برای خاموش‌کردنِ آگاهانهٔ یک مسیر از راهِ پیکربندی).
    """
    if limit <= 0:
        return

    window = window_seconds or settings.rl_window_seconds
    _prune(db)
    db.add(LookupAttempt(kind=kind, scope=scope_key(raw_scope)))
    db.commit()  # پیش از هر raise — شمارش نباید با rollback از بین برود

    used = db.execute(
        select(func.count())
        .select_from(LookupAttempt)
        .where(
            LookupAttempt.kind == kind,
            LookupAttempt.scope == scope_key(raw_scope),
            LookupAttempt.created_at > utcnow() - timedelta(seconds=window),
        )
    ).scalar_one()

    if int(used) > limit:
        raise AppError("TOO_MANY_ATTEMPTS", message or _TOO_MANY, 429)


def global_hit(
    db: Session,
    kind: str,
    *,
    limit: int,
    window_seconds: int | None = None,
    message: str | None = None,
) -> None:
    """سقفِ سراسریِ همان مسیر (بی توجه به مبدأ) — دفاعِ عمقیِ لایهٔ دوم.

    چرا هنوز لازم است حالا که per-IP داریم؟ چون مهاجمِ توزیع‌شده (botnet یا
    چرخانندهٔ IP) هر بار در سطلِ تازه می‌افتد؛ این سقف دستِ‌کم نرخِ کلِ اوراکل را
    محدود می‌کند. سطلش جداست تا شمارشِ per-IP را آلوده نکند.
    """
    hit(db, f"{kind}:all", "", limit=limit, window_seconds=window_seconds, message=message)
