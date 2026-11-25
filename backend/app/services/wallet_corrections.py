"""One ledger, two independent balance concepts, one commit per correction."""
import hashlib
import json
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.db.financial_lock import lock_financial_family
from app.db.document_scope import bind_member
from app.models.account import Account
from app.models.family import Member
from app.models.wallet_correction import WalletCorrection
from app.schemas.data import TransactionWrite
from app.schemas.wallet import CorrectionWrite, WalletBalanceOut, decimal_text
from app.services.common import is_admin
from app.services.member_age import today_tehran


def visible_account(db: Session, actor: Member, account_id: UUID, *, owner_only=False, lock=False) -> Account:
    bind_member(db, actor.id)
    query = select(Account).where(Account.family_id == actor.family_id, Account.id == account_id)
    if owner_only or not is_admin(actor):
        query = query.where(Account.member_id == actor.id)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query.execution_options(populate_existing=True))
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)
    return row


def ledger_balance(db: Session, account: Account, *, excluding: UUID | None = None) -> Decimal:
    value = db.scalar(text("SELECT public.wallet_ledger_balance(:aid,:excluded)"),
                      {"aid": account.id, "excluded": excluding})
    if value is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)
    return value


def latest_correction(db: Session, account: Account) -> WalletCorrection | None:
    return db.scalar(select(WalletCorrection).where(WalletCorrection.family_id == account.family_id,
                     WalletCorrection.account_id == account.id).order_by(WalletCorrection.revision.desc()).limit(1))


def current_balance(db: Session, account: Account, ledger: Decimal | None = None) -> Decimal:
    ledger = ledger_balance(db, account) if ledger is None else ledger
    anchor = latest_correction(db, account)
    return ledger + anchor.target_balance - anchor.ledger_after if anchor and anchor.mode == "reconciliation" else ledger


def read_balance(db: Session, actor: Member, account_id: UUID) -> WalletBalanceOut:
    # Shared financial lock makes all snapshot reads agree without locking ledger rows.
    lock_financial_family(db, actor.family_id)
    account = visible_account(db, actor, account_id)
    ledger = ledger_balance(db, account)
    anchor = latest_correction(db, account)
    active = anchor if anchor and anchor.mode == "reconciliation" else None
    current = ledger + active.target_balance - active.ledger_after if active else ledger
    return WalletBalanceOut(account_id=str(account.id), revision=account.balance_revision,
                            ledger_balance=ledger, current_balance=current, discrepancy=current-ledger,
                            active_reconciliation_id=str(active.id) if active else None)


def list_history(db: Session, actor: Member, account_id: UUID) -> list[WalletCorrection]:
    visible_account(db, actor, account_id)
    return list(db.scalars(select(WalletCorrection).where(WalletCorrection.family_id == actor.family_id,
                           WalletCorrection.account_id == account_id).order_by(WalletCorrection.revision.desc())))


def operation_receipt(db: Session, actor: Member, account_id: UUID, operation_id: UUID) -> WalletCorrection:
    visible_account(db, actor, account_id, owner_only=True)
    row = db.scalar(select(WalletCorrection).where(WalletCorrection.family_id == actor.family_id,
                    WalletCorrection.account_id == account_id, WalletCorrection.created_by == actor.id,
                    WalletCorrection.operation_id == operation_id))
    if row is None:
        raise AppError("NOT_FOUND", "نتیجهٔ اصلاح موجودی یافت نشد.", 404)
    return row


def commit_correction(db: Session) -> None:
    db.commit()


def apply_correction(db: Session, actor: Member, account_id: UUID, req: CorrectionWrite) -> WalletCorrection:
    from app.services import transactions
    lock_financial_family(db, actor.family_id)
    account = visible_account(db, actor, account_id, owner_only=True, lock=True)
    values = req.model_dump(mode="json", exclude={"operation_id"})
    values.update(account_id=str(account_id), target_balance=decimal_text(req.target_balance))
    fingerprint = hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = db.scalar(select(WalletCorrection).where(WalletCorrection.family_id == actor.family_id,
                         WalletCorrection.operation_id == req.operation_id))
    if existing:
        if existing.created_by != actor.id or existing.account_id != account_id or existing.request_hash != fingerprint:
            raise AppError("OPERATION_CONFLICT", "شناسهٔ این اصلاح قبلاً برای درخواست دیگری استفاده شده است.", 409)
        return existing
    if account.balance_revision != req.base_revision:
        raise AppError("WALLET_CONFLICT", "موجودی تغییر کرده است؛ اطلاعات تازه را بررسی و دوباره تأیید کنید.", 409)
    ledger = ledger_balance(db, account)
    before = current_balance(db, account, ledger)
    delta = req.target_balance - (ledger if req.mode == "ledger" else before)
    transaction = None
    if req.mode == "ledger" and delta:
        transaction = transactions.create_uncommitted(db, actor.family_id, TransactionWrite(
            member_id=str(actor.id), type="income" if delta > 0 else "expense", amount=abs(delta),
            category="adjust-i" if delta > 0 else "adjust-e", date=today_tehran(),
            note=req.description, account_id=str(account_id)), actor=actor, source_kind="wallet_correction")
    db.flush()
    db.refresh(account)  # DB triggers also advance revisions for fees/generated writers.
    receipt = WalletCorrection(family_id=actor.family_id, account_id=account_id, created_by=actor.id,
        operation_id=req.operation_id, request_hash=fingerprint, mode=req.mode, revision=account.balance_revision+1,
        target_balance=req.target_balance, ledger_before=ledger, current_before=before,
        ledger_after=req.target_balance if req.mode == "ledger" else ledger, current_after=req.target_balance,
        delta=delta, description=req.description, transaction_id=transaction.id if transaction else None)
    db.add(receipt)
    try:
        commit_correction(db)
    except IntegrityError as exc:
        db.rollback()
        # A receipt owned by another ordinary member is intentionally invisible
        # under RLS. Its tenant-wide ID must still fail as a conflict, not a 500.
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_wallet_family_operation":
            raise AppError("OPERATION_CONFLICT", "شناسهٔ این اصلاح قبلاً استفاده شده است؛ درخواست تکراری متفاوت پذیرفته نمی‌شود.", 409) from None
        raise
    db.refresh(receipt)
    return receipt
