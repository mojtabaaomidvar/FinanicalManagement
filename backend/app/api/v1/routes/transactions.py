"""روتِ تراکنش‌ها — خواندن (فاز ۶) + نوشتن (فاز ۷).

وابستگی get_tenant_member زمینهٔ RLS خانواده را روی تراکنشِ درخواست می‌گذارد؛ پس
کوئری‌ها و نوشتن‌ها هم در لایهٔ اپ و هم در دیتابیس به همان خانواده محدودند
(fail-closed).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import (
    CaptionUpdate,
    OccurrenceMark,
    PhotoCreate,
    PhotoOut,
    TransactionOut,
    TransactionWrite,
)
from app.services import transactions as tx_service
from app.services.common import to_uuid

router = APIRouter(tags=["transactions"])


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[TransactionOut]:
    rows = tx_service.list_for_family(db, member.family_id)
    return [TransactionOut.of(tx, photos) for tx, photos in rows]


@router.post("/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def add_transaction(
    body: TransactionWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> TransactionOut:
    row = tx_service.create(db, member.family_id, body)
    return TransactionOut.of(row, [])


@router.patch("/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_transaction(
    tx_id: str,
    body: TransactionWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    tx_service.update(
        db, member.family_id, to_uuid(tx_id, "NOT_FOUND", "تراکنش یافت نشد.", 404), body
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    tx_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    tx_service.delete(db, member, to_uuid(tx_id, "NOT_FOUND", "تراکنش یافت نشد.", 404))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/transactions/{tx_id}/occurrences", status_code=status.HTTP_204_NO_CONTENT)
def mark_recurring_occurrence(
    tx_id: str,
    body: OccurrenceMark,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    tx_service.mark_occurrence(
        db, member, to_uuid(tx_id, "NOT_FOUND", "تراکنش یافت نشد.", 404), body.due_date
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/transactions/{tx_id}/photos",
    response_model=PhotoOut,
    status_code=status.HTTP_201_CREATED,
)
def add_tx_photo(
    tx_id: str,
    body: PhotoCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> PhotoOut:
    row = tx_service.add_photo(
        db, member, to_uuid(tx_id, "NOT_FOUND", "تراکنش یافت نشد.", 404), body
    )
    return PhotoOut.of(row)


@router.patch("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_tx_photo_caption(
    photo_id: str,
    body: CaptionUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    tx_service.update_photo_caption(
        db, member, to_uuid(photo_id, "NOT_FOUND", "تصویر یافت نشد.", 404), body.caption
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tx_photo(
    photo_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    tx_service.delete_photo(
        db, member, to_uuid(photo_id, "NOT_FOUND", "تصویر یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
