"""روت بازار — قیمت لحظه‌ای طلا/ارز، شاخص بورس و جست‌وجوی نماد (BrsApi).

هویتی (get_current_member) است، نه خانواده‌محور: دادهٔ بازار جهانی/ملی است و
RLS ربطی به آن ندارد؛ فقط باید کاربرِ وارد‌شده باشد. کش و نرمال‌سازی در
app/services/market است.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_member
from app.models.family import Member
from app.schemas.market import MarketSnapshotOut, StockSearchOut
from app.services import market as market_service

router = APIRouter(tags=["market"])


@router.get("/market/prices", response_model=MarketSnapshotOut)
def get_market_prices(
    _: Member = Depends(get_current_member),
) -> MarketSnapshotOut:
    """اسنپ‌شات کش‌شدهٔ بازار: طلا، ارز و شاخص کل بورس."""
    return market_service.get_market_snapshot()


@router.get("/market/stocks", response_model=StockSearchOut)
def search_market_stocks(
    q: str = Query("", max_length=60, description="نماد یا نامِ شرکت"),
    limit: int = Query(25, ge=1, le=50),
    _: Member = Depends(get_current_member),
) -> StockSearchOut:
    """جست‌وجوی تک‌سهم روی فهرستِ کشِ‌شدهٔ نمادها (فیلتر سمتِ سرور).

    کلاینت فقط q را می‌فرستد؛ چند هزار نماد هرگز به گوشی نمی‌رسد. قیمت همان
    لحظه‌ای است که سرور فهرست را گرفته و در fetched_at اعلام می‌شود.
    """
    return market_service.search_stocks(q, limit)
