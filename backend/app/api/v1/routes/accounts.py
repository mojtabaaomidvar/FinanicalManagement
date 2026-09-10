"""روتِ حساب‌ها/کارت‌ها — خواندن (فاز ۶) + نوشتن (فاز ۷).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import AccountCreate, AccountOut, AccountUpdate
from app.services import accounts as account_service
from app.services.common import to_uuid

router = APIRouter(tags=["accounts"])


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[AccountOut]:
    return [AccountOut.of(a) for a in account_service.list_for_family(db, member.family_id)]


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def add_account(
    body: AccountCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> AccountOut:
    return AccountOut.of(account_service.create(db, member.family_id, body))


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: str,
    body: AccountUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> AccountOut:
    row = account_service.update(
        db, member, to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404), body
    )
    return AccountOut.of(row)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    account_service.delete(
        db, member, to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
