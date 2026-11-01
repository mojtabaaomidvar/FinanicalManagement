"""روت §۱.۹ قبوض و شارژ.

**همه تحت `get_tenant_member`** — جدولِ `bills` زیرِ RLS است. (قاعده‌ای که
از §۷ در آمد: اگر درخواست حتی یک جدولِ RLSدار را بخواند، وابستگی‌اش
`get_tenant_member` است؛ نه بر پایهٔ اینکه «مفهوم» کجا زندگی می‌کند.)

`pay` و `unpay` هم تراکنش را دست می‌زنند که خودش زیرِ RLS است، پس زمینه
دوچندان لازم است.

- GET    /bills                 : فهرست (پرداخت‌نشده‌ها اول).
- POST   /bills                 : قبضِ تازه → ۲۰۱.
- PATCH  /bills/{id}            : ویرایش (قبضِ پرداخت‌شده ۴۰۹ می‌دهد).
- DELETE /bills/{id}            : حذف (قبضِ پرداخت‌شده ۴۰۹ می‌دهد) → ۲۰۴.
- POST   /bills/{id}/pay        : بستنِ قبض + ساختِ تراکنشِ هزینه (یک commit).
- POST   /bills/{id}/unpay      : برگرداندنِ پرداخت + حذفِ تراکنش.
- POST   /bills/{id}/cancel     : «نمی‌پردازم» — بی‌ساختِ تراکنش.

`state` عمداً در بدنهٔ PATCH نیست: حالت فقط با این کنش‌ها عوض می‌شود، وگرنه
کلاینت می‌توانست قبض را «پرداخت‌شده» کند بی‌آنکه خرجی ثبت شود.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import BillOut, BillPay, BillWrite
from app.services import bills as bill_service

router = APIRouter(tags=["bills"])


@router.get("/bills", response_model=list[BillOut])
def list_bills(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[BillOut]:
    return bill_service.list_for_family(db, member)


@router.post("/bills", response_model=BillOut, status_code=status.HTTP_201_CREATED)
def create_bill(
    body: BillWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BillOut:
    return bill_service.create(db, member, body)


@router.patch("/bills/{bill_id}", response_model=BillOut)
def update_bill(
    bill_id: str,
    body: BillWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BillOut:
    return bill_service.update(db, member, bill_service.bill_uuid(bill_id), body)


@router.delete("/bills/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bill(
    bill_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    bill_service.remove(db, member, bill_service.bill_uuid(bill_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bills/{bill_id}/pay", response_model=BillOut)
def pay_bill(
    bill_id: str,
    body: BillPay,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BillOut:
    return bill_service.pay(db, member, bill_service.bill_uuid(bill_id), body)


@router.post("/bills/{bill_id}/unpay", response_model=BillOut)
def unpay_bill(
    bill_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BillOut:
    return bill_service.unpay(db, member, bill_service.bill_uuid(bill_id))


@router.post("/bills/{bill_id}/cancel", response_model=BillOut)
def cancel_bill(
    bill_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BillOut:
    return bill_service.cancel(db, member, bill_service.bill_uuid(bill_id))
