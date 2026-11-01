"""روت §۱.۸ انبار خانه.

**همه تحت `get_tenant_member`** — `inventory_items` زیرِ RLS + FORCE است.

- GET    /inventory              : فهرست (کم‌شده‌ها اول).
- POST   /inventory              : قلمِ تازه → ۲۰۱ (عنوانِ تکراری ۴۰۹).
- PATCH  /inventory/{id}         : ویرایش.
- POST   /inventory/{id}/adjust  : «+۱» / «−۱» — تغییرِ نسبی.
- DELETE /inventory/{id}         : حذف → ۲۰۴.

`adjust` عمداً نسبی است نه مطلق: دو نفر می‌توانند هم‌زمان انبار را دست
بزنند و «بگذار روی ۳» آخرین‌نویسنده-برنده است، ولی «یکی کم کن» نیست.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import InventoryAdjust, InventoryOut, InventoryWrite
from app.services import inventory as inventory_service

router = APIRouter(tags=["inventory"])


@router.get("/inventory", response_model=list[InventoryOut])
def list_inventory(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[InventoryOut]:
    return inventory_service.list_for_family(db, member)


@router.post(
    "/inventory", response_model=InventoryOut, status_code=status.HTTP_201_CREATED
)
def create_item(
    body: InventoryWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> InventoryOut:
    return inventory_service.create(db, member, body)


@router.patch("/inventory/{item_id}", response_model=InventoryOut)
def update_item(
    item_id: str,
    body: InventoryWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> InventoryOut:
    return inventory_service.update(
        db, member, inventory_service.inventory_uuid(item_id), body
    )


@router.post("/inventory/{item_id}/adjust", response_model=InventoryOut)
def adjust_item(
    item_id: str,
    body: InventoryAdjust,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> InventoryOut:
    return inventory_service.adjust(
        db, member, inventory_service.inventory_uuid(item_id), body.delta
    )


@router.delete("/inventory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    inventory_service.remove(db, member, inventory_service.inventory_uuid(item_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
