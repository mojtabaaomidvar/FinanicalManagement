"""روت بازار — قیمت لحظه‌ای طلا/ارز و شاخص بورس (BrsApi).

هویتی (get_current_member) است، نه خانواده‌محور: دادهٔ بازار جهانی/ملی است و
RLS ربطی به آن ندارد؛ فقط باید کاربرِ وارد‌شده باشد. کش و نرمال‌سازی در
app/services/market است.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_member
from app.models.family import Member
from app.schemas.market import MarketSnapshotOut
from app.services import market as market_service

router = APIRouter(tags=["market"])


@router.get("/market/prices", response_model=MarketSnapshotOut)
def get_market_prices(
    _: Member = Depends(get_current_member),
) -> MarketSnapshotOut:
    """اسنپ‌شات کش‌شدهٔ بازار: طلا، ارز و شاخص کل بورس."""
    return market_service.get_market_snapshot()
