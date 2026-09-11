"""قرارداد خروجی ماژول بازار (BrsApi) — قیمت طلا/ارز، شاخص بورس و جست‌وجوی نماد.

برخلاف schemas/data.py این خروجی از دیتابیس نمی‌آید؛ سرویسِ market از BrsApi
می‌خواند و همین قرارداد را می‌سازد. نام‌گذاری snake_case تا mappers.ts فرانت
هم‌سان با سایر قراردادها بخواندش.
"""

from __future__ import annotations

from pydantic import BaseModel


class MarketItemOut(BaseModel):
    """یک قلم قیمت (دلار، سکه امامی، طلای ۱۸ و…)."""

    symbol: str
    name: str
    price: float
    change_value: float
    change_percent: float
    unit: str
    date: str
    time: str


class BourseOut(BaseModel):
    """شاخص کل بورس تهران (TSETMC) — لحظه‌ای."""

    date: str
    time: str
    state: str                 # باز / بسته
    index: float
    index_change: float
    index_change_percent: float
    index_equalweight: float
    index_equalweight_change: float
    market_value: float        # mv — ارزش بازار
    trades_count: float        # tno — تعداد معاملات
    trades_volume: float       # tvol — حجم معاملات
    trades_value: float        # tval — ارزش معاملات


class MarketSnapshotOut(BaseModel):
    """اسنپ‌شات کش‌شدهٔ بازار — یک درخواست، همهٔ بخش‌ها."""

    updated_at: str            # ISO زمانِ گرفتن از بالادست (قدیمی‌ترین بخش)
    stale: bool                # true = بالادست خطا داد و نسخهٔ کشِ قدیمی برگشت
    gold: list[MarketItemOut]
    currency: list[MarketItemOut]
    bourse: BourseOut | None   # None = شاخص هنوز دریافت نشده/خطا داشت


class StockOut(BaseModel):
    """یک نمادِ بورس/فرابورس — قیمتِ همان لحظه‌ای که سرور از بالادست گرفته."""

    symbol: str                # نمادِ معاملاتی، مثلِ «فولاد»
    name: str                  # نامِ کامل شرکت
    price: float               # آخرین معامله
    change_percent: float      # درصدِ تغییرِ آخرین معامله
    close_price: float         # قیمتِ پایانی
    close_change_percent: float
    volume: float              # حجمِ معاملات
    value: float               # ارزشِ معاملات (ریال)
    trades_count: float        # تعدادِ معاملات
    low: float                 # کمترین قیمتِ روز
    high: float                # بیشترین قیمتِ روز
    yesterday: float           # قیمتِ دیروز
    event_time: str            # ساعتِ آخرین رویداد روی تابلو (از بالادست)
    market: str                # بورس / فرابورس / …


class StockSearchOut(BaseModel):
    """نتیجهٔ جست‌وجوی نماد — فیلترِ سمتِ سرور روی فهرستِ کشِ‌شده.

    fetched_at همان لحظه‌ای است که سرور فهرست را از بالادست گرفته؛ UI آن را
    کنارِ قیمت نشان می‌دهد تا کاربر بداند عدد مالِ چه زمانی است.
    """

    query: str
    fetched_at: str            # ISO — زمانِ گرفتنِ فهرست از بالادست
    stale: bool                # true = بالادست خطا داد و کشِ قدیمی برگشت
    total: int                 # تعدادِ کلِ تطبیق‌ها (پیش از بُرشِ limit)
    results: list[StockOut]
