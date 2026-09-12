"""روتِ دارایی‌های بازاری — مقدارِ طلا/ارز/رمزارز/سهمِ کاربر.

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
خروجیِ فهرست شاملِ قیمت و ارزشِ امروز است؛ هیچ مبلغی در دیتابیس نیست.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import HoldingCreate, HoldingListOut, HoldingOut, HoldingUpdate
from app.services import holdings as holding_service
from app.services.common import to_uuid

router = APIRouter(tags=["holdings"])


@router.get("/holdings", response_model=HoldingListOut)
def list_holdings(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> HoldingListOut:
    return holding_service.valued_list(db, member.family_id)


@router.post("/holdings", response_model=HoldingOut, status_code=status.HTTP_201_CREATED)
def add_holding(
    body: HoldingCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> HoldingOut:
    # پاسخِ ساخت عمداً بی‌قیمت است (price=0, priced=false): کلاینت بلافاصله
    # فهرست را دوباره می‌گیرد و قیمت‌ها یک‌جا می‌آیند. اگر این‌جا هم قیمت
    # می‌گرفتیم، هر «افزودن» یک بارِ اضافهٔ ارزش‌گذاری داشت بی‌آنکه لازم باشد.
    return HoldingOut.of(holding_service.create(db, member, body), 0.0, False)


@router.patch("/holdings/{holding_id}", response_model=HoldingOut)
def update_holding(
    holding_id: str,
    body: HoldingUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> HoldingOut:
    row = holding_service.update(
        db, member, to_uuid(holding_id, "NOT_FOUND", "دارایی یافت نشد.", 404), body
    )
    # مثلِ افزودن، بی‌قیمت برمی‌گردد؛ فهرستِ بعدی قیمت‌ها را یک‌جا می‌آورد.
    return HoldingOut.of(row, 0.0, False)


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    holding_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    holding_service.delete(
        db, member, to_uuid(holding_id, "NOT_FOUND", "دارایی یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
