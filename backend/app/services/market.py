"""سرویس بازار — پروکسیِ کش‌شدهٔ BrsApi (قیمت طلا/ارز/رمزارز + شاخص بورس + جست‌وجوی سهم).

چرا از بک‌اند و نه مستقیم از کلاینت: کلیدِ API نباید در باندلِ PWA لو برود و
محدودیتِ CORS هم پیش نمی‌آید. کشِ سرور-سمتی با TTL (پیش‌فرض ۵ دقیقه) سقفِ
پلنِ رایگان BrsApi (۱۵۰۰ درخواست/روز برای طلا/ارز و ۱۰۰۰ برای شاخص) را با
خیال راحت نگه می‌دارد؛ بدترین حالت ~۲۸۸ درخواست/روز است.

سه دستهٔ قیمت از یک فراخوانیِ Gold_Currency می‌آیند و همان‌جا تفکیک می‌شوند:
طلا/سکه، ارز، و رمزارز. رمزارز تا ۲۰۲۶-۰۹-۱۲ دور ریخته می‌شد؛ حالا دستهٔ
سومِ خروجی است (هزینهٔ اضافه ندارد، چون داده در همان پاسخ بود).

خطای بالادست: اگر کشِ منقضی‌شده‌ای باشد، همان با stale=true برگردانده می‌شود
(کاربر قیمتِ کمی قدیمی می‌بیند، نه خطا). فقط وقتی هیچ داده‌ای در کار نیست
AppError پرتاب می‌شود.

دقتِ داده: خروجیِ مستندات‌شدهٔ BrsApi اعداد را گاه رشته می‌فرستد و منفی را
پسوند می‌کند («33000.22-»)؛ _parse_num همهٔ این حالت‌ها را تحمل می‌کند.

جست‌وجوی تک‌سهم: فهرستِ کاملِ نمادهای بورس/فرابورس یک‌جا از AllSymbols.php
گرفته و روی سرور کش می‌شود، بعد همان‌جا فیلتر می‌شود. پس جست‌وجوی کاربر
هیچ درخواستِ تازه‌ای به بالادست نمی‌زند (سهمیه‌ی رایگان با تایپِ کاربر
نمی‌سوزد) و قیمتْ همان لحظه‌ای است که سرور آخرین بار گرفته — زمانش هم در
fetched_at برگردانده می‌شود تا UI صریح نشانش دهد.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

import httpx

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.schemas.market import (
    BourseOut,
    MarketItemOut,
    MarketSnapshotOut,
    StockOut,
    StockSearchOut,
)

_BASE = "https://api.brsapi.ir"

# مهلتِ هر فراخوانیِ بالادست. عمداً ۶ ثانیه و نه ۱۰: اسنپ‌شات در بدترین حالت
# دو فراخوانیِ پشت‌سرهم دارد و کلاینت (restClient.ts) در ۱۵ ثانیه می‌بُرد؛
# ۲×۶ + سرباری < ۱۵ می‌ماند، پس کاربر «خطای شبکه» نمی‌بیند.
_TIMEOUT = httpx.Timeout(6.0)

# عاملِ کاربرِ مرورگرمانند — الزامی، نه احتیاط. مستندِ خودِ BrsApi می‌گوید
# یوزرایجنتِ کتابخانه‌های پایتون را «فایروال ۶جی» مسدود می‌کند، پس بدونِ این
# هدر همهٔ فراخوان‌ها 403 Forbidden می‌شوند حتی با کلیدِ کاملاً معتبر.
# رشتهٔ زیر و Accept، عیناً همان نمونهٔ رسمیِ مستندِ BrsApi است.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/106.0.0.0"
)
_ACCEPT = "application/json, text/plain, */*"

# نام‌های رمزارز از فهرستِ رسمیِ BrsApi. تا پیش از این این‌ها دور ریخته
# می‌شدند؛ حالا دستهٔ سومِ خروجی‌اند (خواستهٔ محصول، ۲۰۲۶-۰۹-۱۲).
_CRYPTO_NAMES = {
    "بیتکوین", "اتریوم", "ایکسآرپی", "تتر", "بیانبی", "سولانا", "یواسدی کوین",
    "کاردانو", "دوجکوین", "ترون", "چینلینک", "استلار", "آوالانچ", "شیبا اینو",
    "لایتکوین", "پولکادات", "یونیسواپ", "فایلکوین", "کازماس", "پالیگان",
}

# تورِ ایمنیِ رمزارز. فهرستِ بالا دستی است و BrsApi هر وقت سکهٔ تازه‌ای اضافه
# کند در آن نیست؛ تا دیروز بی‌اهمیت بود (همه‌چیزِ ناشناخته در «ارز» می‌افتاد و
# دیده نمی‌شد) ولی حالا که رمزارز بخشِ جداست، یک سکهٔ جدید اشتباهاً کنارِ دلار
# می‌نشیند. پس نمادِ لاتین را هم می‌سنجیم: نمادهای رمزارز در خروجیِ BrsApi
# لاتین‌اند (BTC, ETH…) در حالی که ارز/طلا نمادِ فارسی یا کدِ ارزی دارند.
_CRYPTO_SYMBOLS = {
    "BTC", "ETH", "XRP", "USDT", "BNB", "SOL", "USDC", "ADA", "DOGE", "TRX",
    "LINK", "XLM", "AVAX", "SHIB", "LTC", "DOT", "UNI", "FIL", "ATOM", "MATIC",
    "TON", "BCH", "NEAR", "APT", "ARB", "OP", "PEPE", "SUI", "ICP", "ETC",
}

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٫،٬", "0123456789..,")

# یکسان‌سازیِ حرف‌های هم‌شکلِ عربی/فارسی + حذفِ اعراب — فقط برای جست‌وجو.
_FA_LETTERS = str.maketrans(
    {
        "ي": "ی",
        "ك": "ک",
        "ؤ": "و",
        "إ": "ا",
        "أ": "ا",
        "آ": "ا",
        "ة": "ه",
        "ۀ": "ه",
        "ـ": "",
    }
)


def _norm(name: str) -> str:
    """نام فارسی نرمال‌شده برای مقایسه (بدون فاصله/نیم‌فاصله)."""
    return (name or "").replace(" ", "").replace("\u200c", "")


def _norm_search(s: str) -> str:
    """نرمال‌سازیِ جست‌وجو: حرف‌های هم‌شکلِ عربی/فارسی، ارقام، فاصله و نیم‌فاصله.

    بی‌این، جست‌وجوی «پالایش» با نمادی که «ي»/«ك» عربی دارد جور نمی‌شود و
    کاربر خیال می‌کند سهم پیدا نشد.
    """
    return (
        (s or "")
        .translate(_FA_LETTERS)
        .translate(_FA_DIGITS)
        .replace(" ", "")
        .replace("‌", "")
        .lower()
    )


def _is_crypto(name: str, symbol: str = "") -> bool:
    """رمزارز است؟ اول نامِ فارسی، بعد نمادِ لاتین (تورِ ایمنیِ سکه‌های تازه)."""
    n = _norm(name)
    if any(n == _norm(c) for c in _CRYPTO_NAMES):
        return True
    return (symbol or "").strip().upper() in _CRYPTO_SYMBOLS


def _is_gold(name: str) -> bool:
    """فلزِ گران‌بها (طلا/سکه/نقره/پلاتین/انس) — وگرنه در فهرستِ «ارز» می‌افتد."""
    n = _norm(name)
    return any(k in n for k in ("طلا", "سکه", "نقره", "پلاتین", "پالادیوم", "انس"))


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


# کلیدهای بخش‌بندیِ خروجیِ Gold_Currency. BrsApi گاهی فهرستِ تخت می‌دهد و گاهی
# شیءِ بخش‌بندی‌شده؛ مستندِ خودشان هم پارامترِ `section=gold,currency` دارد.
# املاهای جمع/مفرد و currency/currencies هر دو پوشش داده شده‌اند.
_SECTION_KEYS: dict[str, tuple[str, ...]] = {
    "gold": ("gold", "golds", "طلا"),
    "currency": ("currency", "currencies", "ارز"),
    "crypto": ("cryptocurrency", "cryptocurrencies", "crypto", "cryptos", "رمزارز"),
}


def _rows_of(v: object) -> list[dict]:
    """هر مقدار → فهرستی از ردیف‌های dict (هر چیز دیگری دور ریخته می‌شود)."""
    if isinstance(v, list):
        return [r for r in v if isinstance(r, dict)]
    return []


def _split_prices(
    payload: object,
) -> tuple[list[MarketItemOut], list[MarketItemOut], list[MarketItemOut]]:
    """خروجیِ Gold_Currency → (طلا، ارز، رمزارز). هر دو شکلِ ممکن را می‌فهمد.

    چرا این تابع لازم شد: پیش‌تر کد فقط `isinstance(payload, list)` را می‌پذیرفت و
    اگر پاسخ شیءِ بخش‌بندی‌شده بود آن را **بی‌صدا** به [] تبدیل می‌کرد — نه خطا،
    نه پرچمِ stale. نتیجه‌اش صفحه‌ای بود که بدونِ هیچ توضیحی طلا و ارز را نشان
    نمی‌داد، در حالی که بورس (از اندپوینتِ دیگری) سالم می‌آمد.

    وقتی پاسخ بخش‌بندی‌شده باشد، خودِ کلیدِ بخش معتبرترین منبعِ دسته‌بندی است و
    به حدسِ نام/نماد ترجیح داده می‌شود. `_is_crypto` فقط داخلِ بخشِ «ارز» اجرا
    می‌شود تا اگر بالادست رمزارز را همان‌جا ریخته بود بیرون کشیده شود.
    """
    # شکلِ ۱ — فهرستِ تخت: دسته‌بندی از روی نام/نماد
    if isinstance(payload, list):
        gold: list[MarketItemOut] = []
        currency: list[MarketItemOut] = []
        crypto: list[MarketItemOut] = []
        for r in _rows_of(payload):
            item = _map_item(r)
            if _is_crypto(str(r.get("name") or ""), item.symbol):
                crypto.append(item)
            elif _is_gold(str(r.get("name") or "")):
                gold.append(item)
            else:
                currency.append(item)
        return gold, currency, crypto

    # شکلِ ۲ — شیءِ بخش‌بندی‌شده: کلیدِ بخش حرفِ آخر را می‌زند
    if isinstance(payload, dict):
        found: dict[str, list[MarketItemOut]] = {"gold": [], "currency": [], "crypto": []}
        hit = False
        for bucket, keys in _SECTION_KEYS.items():
            for k in keys:
                if k in payload:
                    hit = True
                    found[bucket].extend(_map_item(r) for r in _rows_of(payload[k]))
                    break
        if hit:
            # رمزارزی که بالادست داخلِ «ارز» گذاشته باشد را جدا می‌کنیم
            keep: list[MarketItemOut] = []
            for it in found["currency"]:
                (found["crypto"] if _is_crypto(it.name, it.symbol) else keep).append(it)
            found["currency"] = keep
            return found["gold"], found["currency"], found["crypto"]

    # شکلِ ناشناخته — عمداً بلند خطا می‌دهیم. سکوت همان اشکالی بود که ساعت‌ها
    # وقت برد؛ کلیدهای واقعی در پیام می‌آیند تا تشخیص فوری باشد.
    shape = (
        f"کلیدها: {sorted(payload)[:8]}"
        if isinstance(payload, dict)
        else f"نوع: {type(payload).__name__}"
    )
    raise AppError("SERVER", f"شکلِ پاسخِ طلا/ارزِ BrsApi ناشناخته است — {shape}", 502)


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


def _map_stock(row: dict) -> StockOut:
    """یک ردیفِ AllSymbols.php → StockOut.

    نامِ پارامترها همان متغیرهای فیلترِ tsetmc است (l18 نماد، l30 نامِ کامل،
    pl آخرین معامله، pc قیمتِ پایانی، tno/tvol/tval آمارِ معاملات). چون
    بالادست گاهی نام‌های خواناتر هم می‌فرستد، هر دو شکل خوانده می‌شود.
    """
    return StockOut(
        symbol=str(row.get("l18") or row.get("symbol") or ""),
        name=str(row.get("l30") or row.get("name") or ""),
        price=_parse_num(row.get("pl") if row.get("pl") is not None else row.get("price")),
        change_percent=_parse_num(
            row.get("plp") if row.get("plp") is not None else row.get("change_percent")
        ),
        close_price=_parse_num(row.get("pc") if row.get("pc") is not None else row.get("close")),
        close_change_percent=_parse_num(row.get("pcp")),
        volume=_parse_num(row.get("tvol") if row.get("tvol") is not None else row.get("volume")),
        value=_parse_num(row.get("tval") if row.get("tval") is not None else row.get("value")),
        trades_count=_parse_num(row.get("tno")),
        low=_parse_num(row.get("pmin") if row.get("pmin") is not None else row.get("low")),
        high=_parse_num(row.get("pmax") if row.get("pmax") is not None else row.get("high")),
        yesterday=_parse_num(row.get("py") if row.get("py") is not None else row.get("yesterday")),
        event_time=str(row.get("hEven") or row.get("time") or ""),
        market=str(row.get("market") or row.get("flow_title") or ""),
    )


def _scrub(text: str, key: str) -> str:
    """کلید را از هر متنی که ممکن است لاگ یا به کاربر برگردد پاک می‌کند."""
    return text.replace(key, "***") if key else text


def _fetch(url: str, key: str, extra: dict | None = None) -> object:
    params = {"key": key}
    if extra:
        params.update(extra)
    try:
        # بدونِ این دو هدر، BrsApi با 403 پاسخ می‌دهد (فایروالِ ۶جی، UAِ پایتون).
        headers = {"User-Agent": _USER_AGENT, "Accept": _ACCEPT}
        with httpx.Client(timeout=_TIMEOUT, headers=headers) as client:
            res = client.get(url, params=params)
            res.raise_for_status()
            return res.json()
    except httpx.HTTPStatusError as e:
        # بدنهٔ پاسخ را نگه می‌داریم: BrsApi دلیلِ رد را همان‌جا می‌نویسد
        # (کلیدِ باطل، اتمامِ سهمیه، پلنِ بدونِ دسترسی…). بدونِ این، خطا
        # قابلِ عیب‌یابی نیست. کلید از متن پاک می‌شود.
        body = _scrub((e.response.text or "").strip()[:200], key)
        status = e.response.status_code
        if status in (401, 403):
            raise AppError(
                "SERVER",
                f"BrsApi دسترسی را رد کرد ({status}) — {body or 'بدونِ توضیح'}",
                502,
            ) from e
        raise AppError("SERVER", f"خطای BrsApi ({status}) — {body or '—'}", 502) from e
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


_prices_cache: _Entry | None = None   # (gold, currency, crypto)
_bourse_cache: _Entry | None = None
_symbols_cache: _Entry | None = None  # list[StockOut] — فهرستِ کاملِ نمادها


def _unpack_prices(data: object) -> tuple[list[MarketItemOut], list[MarketItemOut], list[MarketItemOut]]:
    """کشِ قیمت‌ها را باز می‌کند و شکلِ دوتاییِ قدیمی را هم تحمل می‌کند.

    چرا: پیش از افزودنِ رمزارز، کش تاپلِ (gold, currency) بود. اگر پروسه‌ای
    با کشِ گرمِ دوتایی این کد را اجرا کند، unpackِ سه‌تایی ValueError می‌دهد و
    صفحهٔ بازار می‌ترکد. این تابع هر دو شکل را می‌پذیرد.
    """
    if isinstance(data, tuple):
        if len(data) == 3:
            return data  # type: ignore[return-value]
        if len(data) == 2:
            return data[0], data[1], []
    return [], [], []

# قفلِ نوشتنِ کش. عمداً قفلِ جدا برای هر بخش نداریم: نوشتن‌ها کوتاه‌اند.
_lock = threading.Lock()

# قفلِ «یک نفر برود بیاورد» — جلوی هجومِ هم‌زمان به بالادست را می‌گیرد.
# بدونِ این، چند درخواستِ هم‌زمان روی کشِ سرد هرکدام یک فراخوانیِ BrsApi
# می‌زدند و سهمیهٔ رایگان چند برابر می‌سوخت.
_fetch_locks: dict[str, threading.Lock] = {
    "prices": threading.Lock(),
    "bourse": threading.Lock(),
    "symbols": threading.Lock(),
}


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

    # ── طلا/ارز/رمزارز ──
    gold: list[MarketItemOut] = []
    currency: list[MarketItemOut] = []
    crypto: list[MarketItemOut] = []
    if _fresh(_prices_cache, ttl):
        gold, currency, crypto = _unpack_prices(_prices_cache.data)  # type: ignore[union-attr]
    else:
        # فقط یک thread می‌رود بالادست؛ بقیه پشتِ قفل می‌مانند و بعد از آزاد شدن
        # کشِ تازه‌ای که همان نفر نوشته را برمی‌دارند (دوباره _fresh را می‌سنجیم).
        with _fetch_locks["prices"]:
            if _fresh(_prices_cache, ttl):
                gold, currency, crypto = _unpack_prices(_prices_cache.data)  # type: ignore[union-attr]
            else:
                try:
                    payload = _upstream_payload(
                        _fetch(f"{_BASE}/Market/Gold_Currency.php", cfg.brsapi_key)
                    )
                    gold, currency, crypto = _split_prices(payload)
                    if not gold and not currency and not crypto:
                        raise AppError("SERVER", "طلا/ارزِ BrsApi خالی برگشت.", 502)
                    with _lock:
                        _prices_cache = _Entry((gold, currency, crypto))
                except AppError:
                    # کشِ قبلی بهتر از هیچ است، ولی باید «قدیمی» علامت بخورد.
                    # اگر کشی هم نباشد سه فهرست خالی می‌مانند و گاردِ پایین‌تر
                    # خطا را به کاربر می‌رساند.
                    gold, currency, crypto = [], [], []
                    if _prices_cache is not None:
                        gold, currency, crypto = _unpack_prices(_prices_cache.data)
                        stale = True

    # ── شاخص بورس ──
    bourse: BourseOut | None = None
    if _fresh(_bourse_cache, ttl):
        bourse = _bourse_cache.data  # type: ignore[assignment]
    else:
        with _fetch_locks["bourse"]:
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

    if not gold and not currency and not crypto and bourse is None:
        raise AppError("SERVER", "داده‌ای از بازار در دسترس نیست — بعداً دوباره تلاش کنید.", 502)

    # زمانِ نمایشی = *قدیمی‌ترین* بخشِ موجود، نه تازه‌ترین.
    # با max() اگر قیمت‌ها تازه ولی شاخص کهنه بود، کاربر «الان» می‌دید و
    # کهنگیِ شاخص پنهان می‌ماند؛ min() صادق‌تر است.
    with _lock:
        entries = [e for e in (_prices_cache, _bourse_cache) if e is not None]
        oldest = min((e.at for e in entries), default=time.time())
    return MarketSnapshotOut(
        updated_at=datetime.fromtimestamp(oldest, tz=timezone.utc).isoformat(),
        stale=stale,
        gold=gold,
        currency=currency,
        crypto=crypto,
        bourse=bourse,
    )


# ── جست‌وجوی تک‌سهم ──────────────────────────────────────────
# فهرستِ کاملِ نمادها یک‌جا گرفته و کش می‌شود، بعد روی سرور فیلتر می‌شود.
# TTL کوتاه‌تر از اسنپ‌شات است چون قیمتِ سهم در ساعتِ بازار تندتر عوض می‌شود،
# ولی همچنان کش است تا تایپ‌کردنِ کاربر سهمیهٔ رایگان را نسوزاند.
_SYMBOLS_PATH = "/Tsetmc/AllSymbols.php"
_SYMBOLS_TYPE = "1"
_SEARCH_LIMIT = 25


def _symbols_ttl(cfg: Settings) -> float:
    """نصفِ TTLِ اسنپ‌شات، با کفِ ۶۰ و سقفِ ۳۰۰ ثانیه."""
    return min(300.0, max(60.0, float(cfg.market_cache_seconds) / 2))


def _load_symbols(cfg: Settings) -> tuple[list[StockOut], float, bool]:
    """فهرستِ نمادها از کش یا بالادست → (فهرست، زمانِ گرفتن، کهنه‌بودن)."""
    global _symbols_cache
    ttl = _symbols_ttl(cfg)

    if _fresh(_symbols_cache, ttl):
        return _symbols_cache.data, _symbols_cache.at, False  # type: ignore[return-value,union-attr]

    with _fetch_locks["symbols"]:
        if _fresh(_symbols_cache, ttl):
            return _symbols_cache.data, _symbols_cache.at, False  # type: ignore[return-value,union-attr]
        try:
            payload = _upstream_payload(
                _fetch(f"{_BASE}{_SYMBOLS_PATH}", cfg.brsapi_key, {"type": _SYMBOLS_TYPE})
            )
            rows = payload if isinstance(payload, list) else []
            stocks = [_map_stock(r) for r in rows if isinstance(r, dict)]
            stocks = [s for s in stocks if s.symbol]
            if not stocks:
                raise AppError("SERVER", "فهرستِ نمادها خالی برگشت.", 502)
            entry = _Entry(stocks)
            with _lock:
                _symbols_cache = entry
            return stocks, entry.at, False
        except AppError:
            # کشِ منقضی بهتر از خطا است — قیمت کمی قدیمی، ولی قابل استفاده.
            if _symbols_cache is not None:
                return _symbols_cache.data, _symbols_cache.at, True  # type: ignore[return-value]
            raise


def _score(stock: StockOut, q: str) -> int | None:
    """رتبهٔ تطبیق؛ None = بی‌ربط. کمتر = مرتبط‌تر.

    ترتیب عمدی است: نمادِ دقیق → نمادی که با q شروع می‌شود → نمادِ شامل →
    نامِ شرکت. وگرنه جست‌وجوی «فولاد» اول شرکت‌هایی را می‌آورد که «فولاد»
    جایی در وسطِ نامشان است و خودِ نمادِ «فولاد» گم می‌شود.
    """
    sym = _norm_search(stock.symbol)
    name = _norm_search(stock.name)
    if sym == q:
        return 0
    if sym.startswith(q):
        return 1
    if q in sym:
        return 2
    if name.startswith(q):
        return 3
    if q in name:
        return 4
    return None


def search_stocks(
    query: str,
    limit: int = _SEARCH_LIMIT,
    settings: Settings | None = None,
) -> StockSearchOut:
    """جست‌وجوی نمادِ بورس/فرابورس روی فهرستِ کشِ‌شدهٔ سرور.

    فیلتر سمتِ سرور است: کلاینت فقط q را می‌فرستد و چند ردیفِ مرتبط می‌گیرد،
    نه چند هزار نماد. قیمتِ برگشتی همان لحظه‌ای است که سرور فهرست را گرفته و
    fetched_at آن لحظه را صریح اعلام می‌کند.
    """
    cfg = settings or get_settings()
    if not cfg.brsapi_key:
        raise AppError(
            "SERVER_NOT_CONFIGURED",
            "قیمت بازار پیکربندی نشده است — BRSAPI_KEY را در تنظیمات سرور بگذارید.",
            503,
        )

    q = _norm_search(query)
    # عمداً خطا نمی‌دهیم: UI همان‌طور که کاربر تایپ می‌کند صدا می‌زند و یک
    # حرفی‌بودنِ لحظه‌ای «خطا» نیست. ضمناً این‌جا اصلاً سراغِ بالادست نمی‌رویم.
    if len(q) < 2:
        with _lock:
            at = _symbols_cache.at if _symbols_cache is not None else time.time()
        return StockSearchOut(
            query=query.strip(),
            fetched_at=datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
            stale=False,
            total=0,
            results=[],
        )

    stocks, fetched_at, stale = _load_symbols(cfg)

    scored: list[tuple[int, StockOut]] = []
    for s in stocks:
        rank = _score(s, q)
        if rank is not None:
            scored.append((rank, s))

    # رتبه اول، بعد حجمِ معاملات نزولی: بینِ هم‌رتبه‌ها سهمِ پرمعامله‌تر
    # همان چیزی است که کاربر معمولاً دنبالش است.
    scored.sort(key=lambda p: (p[0], -p[1].volume))
    top = max(1, min(int(limit), 50))

    return StockSearchOut(
        query=query.strip(),
        fetched_at=datetime.fromtimestamp(fetched_at, tz=timezone.utc).isoformat(),
        stale=stale,
        total=len(scored),
        results=[s for _, s in scored[:top]],
    )
