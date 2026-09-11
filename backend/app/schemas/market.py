"""قرارداد خروجی ماژول بازار (BrsApi) — قیمت طلا/ارز و شاخص بورس.

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

    updated_at: str            # ISO زمانِ گرفتن از بالادست
    stale: bool                # true = بالادست خطا داد و نسخهٔ کشِ قدیمی برگشت
    gold: list[MarketItemOut]
    currency: list[MarketItemOut]
    bourse: BourseOut | None   # None = شاخص هنوز دریافت نشده/خطا داشت
