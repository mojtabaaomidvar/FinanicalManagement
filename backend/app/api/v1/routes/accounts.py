"""روت حساب‌ها/کارت‌ها — خواندن (فاز ۶) + نوشتن (فاز ۷).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import AccountCreate, AccountDelete, AccountOut, AccountTransferTargetOut, AccountUpdate
from app.services import accounts as account_service
from app.services.common import to_uuid
from app.schemas.wallet import CorrectionOut, CorrectionWrite, WalletBalanceOut
from app.services import wallet_corrections

router = APIRouter(tags=["accounts"])
TenantMember = Annotated[Member, Depends(get_tenant_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/accounts/{account_id}/balance", response_model=WalletBalanceOut)
def wallet_balance(account_id: UUID, member: TenantMember, db: DbSession) -> WalletBalanceOut:
    return wallet_corrections.read_balance(db, member, account_id)


@router.get("/accounts/{account_id}/corrections", response_model=list[CorrectionOut])
def correction_history(account_id: UUID, member: TenantMember, db: DbSession):
    return [CorrectionOut.model_validate(row) for row in wallet_corrections.list_history(db, member, account_id)]


@router.get("/accounts/{account_id}/corrections/{operation_id}", response_model=CorrectionOut)
def correction_receipt(account_id: UUID, operation_id: UUID, member: TenantMember, db: DbSession):
    return CorrectionOut.model_validate(wallet_corrections.operation_receipt(db, member, account_id, operation_id))


@router.post("/accounts/{account_id}/corrections", response_model=CorrectionOut, status_code=status.HTTP_201_CREATED)
def correct_balance(account_id: UUID, req: CorrectionWrite, member: TenantMember, db: DbSession):
    return CorrectionOut.model_validate(wallet_corrections.apply_correction(db, member, account_id, req))


@router.get("/accounts", response_model=list[AccountOut] | list[AccountTransferTargetOut])
def list_accounts(
    member: TenantMember,
    db: DbSession,
    view: Literal["wallets", "transfer-targets"] = "wallets",
) -> list[AccountOut] | list[AccountTransferTargetOut]:
    if view == "transfer-targets":
        return [AccountTransferTargetOut.of(a) for a in account_service.list_transfer_targets(db, member)]
    return [AccountOut.of(a) for a in account_service.list_for_family(db, member)]


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def add_account(
    body: AccountCreate,
    member: TenantMember,
    db: DbSession,
) -> AccountOut:
    return AccountOut.of(account_service.create(db, member, body))


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: str,
    body: AccountUpdate,
    member: TenantMember,
    db: DbSession,
) -> AccountOut:
    row = account_service.update(
        db, member, to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404), body
    )
    return AccountOut.of(row)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    member: TenantMember,
    db: DbSession,
    body: AccountDelete | None = None,
) -> Response:
    account_service.delete(
        db,
        member,
        to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404),
        body.confirmation if body else None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
