"""روت §۱.۸ لیست خرید.

**همه تحت `get_tenant_member`** — `shopping_lists`/`shopping_items` زیرِ
RLS + FORCE هستند. (قاعده‌ای که از §۷ در آمد: اگر درخواست حتی یک جدولِ
RLSدار را بخواند، وابستگی‌اش `get_tenant_member` است؛ نه بر پایهٔ اینکه
«مفهوم» کجا زندگی می‌کند.)

`complete` سه جدول را هم‌زمان دست می‌زند — قلم، تراکنش، انبار — که هر سه
زیرِ RLS‌اند، پس زمینه چندچندان لازم است.

- GET    /shopping/lists                  : همهٔ لیست‌ها + اقلامِ نخریده.
- POST   /shopping/lists                  : لیستِ تازه → ۲۰۱.
- PATCH  /shopping/lists/{id}             : تغییرِ نام.
- DELETE /shopping/lists/{id}             : حذفِ لیست و اقلامش → ۲۰۴.
- POST   /shopping/lists/{id}/items       : افزودنِ قلم → ۲۰۱.
- POST   /shopping/lists/{id}/complete    : «خرید انجام شد» (یک commit).
- PATCH  /shopping/items/{id}             : ویرایشِ قلمِ نخریده.
- POST   /shopping/items/{id}/check       : تیکِ «در سبد است».
- DELETE /shopping/items/{id}             : حذفِ قلمِ نخریده → ۲۰۴.

`checked` و `bought_at` عمداً در بدنهٔ PATCH نیستند: حالت فقط با همین
کنش‌ها عوض می‌شود، وگرنه کلاینت می‌توانست قلم را «خریده‌شده» کند بی‌آنکه
خرجی ثبت شود یا انبار بالا برود.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import (
    ShoppingItemCheck,
    ShoppingItemOut,
    ShoppingItemWrite,
    ShoppingListOut,
    ShoppingListWrite,
    TripComplete,
    TripResult,
)
from app.schemas.offline_shopping import OfflineMutation, OfflineMutationResult, OfflineSnapshot
from app.schemas.shopping_batch import ShoppingBatchRequest, ShoppingBatchResult
from app.services import offline_shopping, usage
from app.services import shopping as shopping_service

router = APIRouter(tags=["shopping"])


@router.get("/shopping/offline", response_model=OfflineSnapshot)
def offline_snapshot(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> OfflineSnapshot:
    return offline_shopping.snapshot(db, member)


@router.post("/shopping/offline/mutations", response_model=OfflineMutationResult)
def offline_mutation(
    body: OfflineMutation,
    request: Request,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> OfflineMutationResult:
    result = offline_shopping.mutate(db, member, body)
    request.state.usage_operation = usage.offline_operation(body.kind)
    return result


@router.get("/shopping/lists", response_model=list[ShoppingListOut])
def list_lists(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[ShoppingListOut]:
    return shopping_service.list_for_family(db, member)


@router.post(
    "/shopping/lists",
    response_model=ShoppingListOut,
    status_code=status.HTTP_201_CREATED,
)
def create_list(
    body: ShoppingListWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> ShoppingListOut:
    return shopping_service.create_list(db, member, body)


@router.patch("/shopping/lists/{list_id}", response_model=ShoppingListOut)
def update_list(
    list_id: str,
    body: ShoppingListWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> ShoppingListOut:
    return shopping_service.update_list(
        db, member, shopping_service.list_uuid(list_id), body
    )


@router.delete("/shopping/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_list(
    list_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    shopping_service.delete_list(db, member, shopping_service.list_uuid(list_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/shopping/lists/{list_id}/items",
    response_model=ShoppingItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_item(
    list_id: str,
    body: ShoppingItemWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> ShoppingItemOut:
    return shopping_service.add_item(
        db, member, shopping_service.list_uuid(list_id), body
    )


@router.post("/shopping/lists/{list_id}/complete", response_model=TripResult)
def complete_trip(
    list_id: str,
    body: TripComplete,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> TripResult:
    return shopping_service.complete_trip(
        db, member, shopping_service.list_uuid(list_id), body
    )


@router.post("/shopping/lists/{list_id}/ensure-missing", response_model=ShoppingBatchResult)
def ensure_missing(
    list_id: str,
    body: ShoppingBatchRequest,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> ShoppingBatchResult:
    return shopping_service.ensure_missing(
        db, member, shopping_service.list_uuid(list_id), body
    )


@router.patch("/shopping/items/{item_id}", response_model=ShoppingItemOut)
def update_item(
    item_id: str,
    body: ShoppingItemWrite,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> ShoppingItemOut:
    return shopping_service.update_item(
        db, member, shopping_service.item_uuid(item_id), body
    )


@router.post("/shopping/items/{item_id}/check", response_model=ShoppingItemOut)
def check_item(
    item_id: str,
    body: ShoppingItemCheck,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> ShoppingItemOut:
    return shopping_service.check_item(
        db, member, shopping_service.item_uuid(item_id), body.checked
    )


@router.delete("/shopping/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    shopping_service.delete_item(db, member, shopping_service.item_uuid(item_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
