"""سرویس بازار — پروکسیِ کش‌شدهٔ BrsApi (قیمت طلا/ارز + شاخص بورس).

چرا از بک‌اند و نه مستقیم از کلاینت: کلیدِ API نباید در باندلِ PWA لو برود و
محدودیتِ CORS هم پیش نمی‌آید. کشِ سرور-سمتی با TTL (پیش‌فرض ۵ دقیقه) سقفِ
پلنِ رایگان BrsApi (۱۵۰۰ درخواست/روز برای طلا/ارز و ۱۰۰۰ برای شاخص) را با
خیال راحت نگه می‌دارد؛ بدترین حالت ~۲۸۸ درخواست/روز است.

خطای بالادست: اگر کشِ منقضی‌شده‌ای باشد، همان با stale=true برگردانده می‌شود
(کاربر قیمتِ کمی قدیمی می‌بیند، نه خطا). فقط وقتی هیچ داده‌ای در کار نیست
AppError پرتاب می‌شود.

دقتِ داده: خروجیِ مستندات‌شدهٔ BrsApi اعداد را گاه رشته می‌فرستد و منفی را
پسوند می‌کند («33000.22-»)؛ _parse_num همهٔ این حالت‌ها را تحمل می‌کند.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

import httpx

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.schemas.market import BourseOut, MarketItemOut, MarketSnapshotOut

_BASE = "https://api.brsapi.ir"
_TIMEOUT = httpx.Timeout(10.0)

# نام‌های رمزارز از فهرستِ رسمیِ BrsApi — خروجیِ رایگانِ Gold_Currency آن‌ها را هم
# برمی‌گرداند؛ خواستهٔ محصول فقط ارز/طلا/بورس است، پس کنار گذاشته می‌شوند.
_CRYPTO_NAMES = {
    "بیتکوین", "اتریوم", "ایکسآرپی", "تتر", "بیانبی", "سولانا", "یواسدی کوین",
    "کاردانو", "دوجکوین", "ترون", "چینلینک", "استلار", "آوالانچ", "شیبا اینو",
    "لایتکوین", "پولکادات", "یونیسواپ", "فایلکوین", "کازماس", "پالیگان",
}

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٫،٬", "0123456789..,")


def _norm(name: str) -> str:
    """نام فارسی نرمال‌شده برای مقایسه (بدون فاصله/نیم‌فاصله)."""
    return (name or "").replace(" ", "").replace("\u200c", "")


def _is_crypto(name: str) -> bool:
    n = _norm(name)
    return any(n == _norm(c) for c in _CRYPTO_NAMES)


def _is_gold(name: str) -> bool:
    n = _norm(name)
    return "طلا" in n or "سکه" in n


def _parse_num(v: object) -> float:
    """عددِ تحمل‌پذیر: int/float/«859,000»/«33000.22-»/«۱٬۲۳۴» → float."""
    if isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().translate(_FA_DIGITS).replace(",", "").replace("٬", "")
    if not s:
        return 0.0
    neg = s.endswith("-")  # فرمتِ BrsApi: منفی گاهی پسوند است
    if neg:
        s = s[:-1]
    s = s.lstrip("+")
    try:
        n = float(s)
    except ValueError:
        return 0.0
    return -n if neg else n


def _unwrap(payload: dict, *keys: str) -> object:
    """اگر پاسخ در پوششِ {successful, data, …} باشد، هستهٔ داده را بیرون می‌کشد."""
    for k in keys:
        v = payload.get(k)
        if v is not None:
            return v
    return payload


def _upstream_payload(payload: object) -> object:
    """پاسخِ خطای BrsApi ({successful:false, message_error}) → AppError؛ وگرنه هسته."""
    if isinstance(payload, dict) and payload.get("successful") is False:
        msg = str(payload.get("message_error") or "خطای سرویس BrsApi.")
        if payload.get("code_http") in (401, 403):
            raise AppError("SERVER", f"کلید BrsApi معتبر نیست — {msg}", 502)
        raise AppError("SERVER", f"خطا از BrsApi — {msg}", 502)
    if isinstance(payload, dict):
        return _unwrap(payload, "data", "items", "result")
    return payload


def _map_item(row: dict) -> MarketItemOut:
    return MarketItemOut(
        symbol=str(row.get("symbol") or ""),
        name=str(row.get("name") or row.get("name_en") or ""),
        price=_parse_num(row.get("price")),
        change_value=_parse_num(row.get("change_value")),
        change_percent=_parse_num(row.get("change_percent")),
        unit=str(row.get("unit") or ""),
        date=str(row.get("date") or ""),
        time=str(row.get("time") or ""),
    )


def _map_bourse(payload: object) -> BourseOut | None:
    """خروجیِ Index.php?type=1 → BourseOut؛ ساختارِ خام یا پوشش‌شده را تحمل می‌کند."""
    core = payload
    if isinstance(core, list):
        core = core[0] if core else None
    if isinstance(core, dict) and "index" not in core:
        inner = _unwrap(core, "data", "result")
        if isinstance(inner, list):
            core = inner[0] if inner else None
        else:
            core = inner
    if not isinstance(core, dict) or "index" not in core:
        return None
    return BourseOut(
        date=str(core.get("date") or ""),
        time=str(core.get("time") or ""),
        state=str(core.get("state") or ""),
        index=_parse_num(core.get("index")),
        index_change=_parse_num(core.get("index_change")),
        index_change_percent=_parse_num(core.get("index_change_percent")),
        index_equalweight=_parse_num(core.get("index_equalWeight")),
        index_equalweight_change=_parse_num(core.get("index_equalWeight_change")),
        market_value=_parse_num(core.get("mv")),
        trades_count=_parse_num(core.get("tno")),
        trades_volume=_parse_num(core.get("tvol")),
        trades_value=_parse_num(core.get("tval")),
    )


def _fetch(url: str, key: str, extra: dict | None = None) -> object:
    params = {"key": key}
    if extra:
        params.update(extra)
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            res = client.get(url, params=params)
            res.raise_for_status()
            return res.json()
    except httpx.HTTPError as e:
        raise AppError("SERVER", f"اتصال به BrsApi برقرار نشد — {type(e).__name__}", 502) from e
    except ValueError as e:  # بدنهٔ غیر-JSON (مثلاً صفحهٔ خطای HTML)
        raise AppError("SERVER", "پاسخ BrsApi قابل خواندن نبود.", 502) from e


# ── کشِ سرور-سمتی ────────────────────────────────────────────
class _Entry:
    __slots__ = ("at", "data")

    def __init__(self, data: object) -> None:
        self.at = time.time()
        self.data = data


_prices_cache: _Entry | None = None   # (gold, currency)
_bourse_cache: _Entry | None = None
_lock = threading.Lock()


def _fresh(entry: _Entry | None, ttl: float) -> bool:
    return entry is not None and time.time() - entry.at < ttl


def get_market_snapshot(settings: Settings | None = None) -> MarketSnapshotOut:
    """اسنپ‌شاتِ بازار — از کشِ تازه، وگرنه فراخوانیِ بالادست.

    بخش‌ها مستقل کش می‌شوند: اگر یکی از دو اندپوینتِ BrsApi خطا بدهد، بخشِ دیگرِ
    تازه می‌ماند و نسخهٔ کشِ قدیمیِ همان بخش با stale=true برگردانده می‌شود.
    """
    cfg = settings or get_settings()
    if not cfg.brsapi_key:
        raise AppError(
            "SERVER_NOT_CONFIGURED",
            "قیمت بازار پیکربندی نشده است — BRSAPI_KEY را در تنظیمات سرور بگذارید.",
            503,
        )
    ttl = max(30.0, float(cfg.market_cache_seconds))

    global _prices_cache, _bourse_cache
    stale = False

    # ── طلا/ارز ──
    gold: list[MarketItemOut] = []
    currency: list[MarketItemOut] = []
    if _fresh(_prices_cache, ttl):
        gold, currency = _prices_cache.data  # type: ignore[assignment,misc]
    else:
        try:
            payload = _upstream_payload(
                _fetch(f"{_BASE}/Market/Gold_Currency.php", cfg.brsapi_key)
            )
            rows = payload if isinstance(payload, list) else []
            for r in rows:
                if not isinstance(r, dict):
                    continue
                name = str(r.get("name") or "")
                if _is_crypto(name):
                    continue
                item = _map_item(r)
                (gold if _is_gold(name) else currency).append(item)
            with _lock:
                _prices_cache = _Entry((gold, currency))
        except AppError:
            if _prices_cache is not None:
                gold, currency = _prices_cache.data  # type: ignore[assignment,misc]
                stale = True

    # ── شاخص بورس ──
    bourse: BourseOut | None = None
    if _fresh(_bourse_cache, ttl):
        bourse = _bourse_cache.data  # type: ignore[assignment]
    else:
        try:
            payload = _upstream_payload(
                _fetch(f"{_BASE}/Tsetmc/Index.php", cfg.brsapi_key, {"type": "1"})
            )
            mapped = _map_bourse(payload)
            if mapped is not None:
                bourse = mapped
                with _lock:
                    _bourse_cache = _Entry(bourse)
            elif _bourse_cache is not None:
                bourse = _bourse_cache.data  # type: ignore[assignment]
                stale = True
            else:
                stale = True
        except AppError:
            if _bourse_cache is not None:
                bourse = _bourse_cache.data  # type: ignore[assignment]
                stale = True
            else:
                stale = True

    if not gold and not currency and bourse is None:
        raise AppError("SERVER", "داده‌ای از بازار در دسترس نیست — بعداً دوباره تلاش کنید.", 502)

    with _lock:
        newest = max(
            (e.at for e in (_prices_cache, _bourse_cache) if e is not None),
            default=time.time(),
        )
    return MarketSnapshotOut(
        updated_at=datetime.fromtimestamp(newest, tz=timezone.utc).isoformat(),
        stale=stale,
        gold=gold,
        currency=currency,
        bourse=bourse,
    )
