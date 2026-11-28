"""حساب‌ها/کارت‌ها: خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

معادل add/update/delete_account قدیمی با همان کدهای خطا. هم‌خوانی ۶ رقم اول
کارت (BIN) با بانک انتخاب‌شده عیناً حفظ شده است. نوع حساب (kind) هنگام ویرایش
تغییرناپذیر است؛ ویرایش مشخصات مبلغ را تغییر نمی‌دهد. اصلاح موجودی مسیر اتمی
و سابقهٔ مستقل خود را دارد.
"""

from __future__ import annotations

import re
import uuid
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session, load_only

from app.core.errors import AppError
from app.db.financial_lock import lock_financial_family
from app.models.account import Account
from app.models.family import Member
from app.schemas.data import AccountCreate, AccountUpdate
from app.services.bank_catalog import card_matches_bank
from app.services.common import is_admin, to_uuid

_MAX_BALANCE = 999999999999999  # ۱۵ نُه — هم‌سان با add/update_account قدیمی


# ── خواندن (فاز ۶) ───────────────────────────────────────────
def list_for_family(db: Session, actor: Member) -> list[Account]:
    query = select(Account).where(Account.family_id == actor.family_id)
    if not is_admin(actor):
        query = query.where(Account.member_id == actor.id)
    return list(db.scalars(query.order_by(Account.created_at.asc(), Account.id.asc())))


def list_transfer_targets(db: Session, actor: Member) -> list[Account]:
    """Fetch routing identifiers only; never read another owner's financial fields."""
    return list(db.scalars(
        select(Account)
        .options(load_only(Account.id, Account.family_id, Account.member_id, Account.kind, raiseload=True))
        .where(Account.family_id == actor.family_id)
        .order_by(Account.created_at.asc(), Account.id.asc())
    ))


# ── کمک‌تابع‌ها ──────────────────────────────────────────────
def _normalize_card(raw: str | None) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return None
    if not re.fullmatch(r"\d{16}", digits):
        raise AppError("INVALID_CARD", "شماره کارت باید ۱۶ رقم باشد.", 422)
    return digits


def _check_bin(db: Session, card: str | None, bank: str | None) -> None:
    """هم‌خوانی ۶ رقم اول کارت با بانک انتخاب‌شده — عیناً مثل RPC قدیمی."""
    bank_t = (bank or "").strip()
    if card is None or not bank_t:
        return
    if not card_matches_bank(card, bank_t):
        raise AppError("BANK_MISMATCH", "شماره کارت با بانک انتخاب‌شده هم‌خوان نیست.", 422)


def _valid_title(title: str | None) -> str:
    t = (title or "").strip()
    if not t or len(t) > 40:
        raise AppError("INVALID_TITLE", "نام حساب نامعتبر است.", 422)
    return t


# ── افزودن / ویرایش / حذف ────────────────────────────────────
def create(db: Session, actor: Member, req: AccountCreate) -> Account:
    lock_financial_family(db, actor.family_id)
    family_id = actor.family_id
    kind = (req.kind or "").strip() or "bank"
    if kind not in ("bank", "wallet"):
        raise AppError("INVALID_KIND", "نوع حساب نامعتبر است.", 422)
    title = _valid_title(req.title)

    member_id = to_uuid(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    target = db.scalar(
        select(Member).where(
            Member.id == member_id,
            Member.family_id == family_id,
            Member.membership_state == "active",
        )
    )
    if target is None:
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)
    if member_id != actor.id and not (
        is_admin(actor) and target.relation == "فرزند" and kind == "bank"
    ):
        raise AppError(
            "FORBIDDEN", "فقط برای خودتان حساب بسازید؛ مدیر می‌تواند برای فرزند حساب اضافه کند.", 403
        )

    initial = req.initial_balance if req.initial_balance is not None else Decimal(0)
    if not initial.is_finite() or initial < 0 or initial > _MAX_BALANCE or initial * 10 != (initial * 10).to_integral_value():
        raise AppError("INVALID_INITIAL_BALANCE", "موجودی اولیه نامعتبر است.", 422)

    card = _normalize_card(req.card_number)
    if kind == "bank" and card is None:
        raise AppError("EMPTY_ACCOUNT", "حساب بانکی باید شماره کارت داشته باشد.", 422)
    _check_bin(db, card, req.bank)

    row = Account(
        family_id=family_id,
        member_id=member_id,
        title=title,
        bank=(req.bank or "").strip() or None,
        card_number=card,
        kind=kind,
        initial_balance=initial,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update(db: Session, actor: Member, account_id: uuid.UUID, req: AccountUpdate) -> Account:
    lock_financial_family(db, actor.family_id)
    # حساب فقط در اختیار صاحب آن است؛ مالکیت تا پایان ویرایش قفل می‌شود.
    stmt = select(Account).where(Account.id == account_id, Account.family_id == actor.family_id)
    stmt = stmt.where(Account.member_id == actor.id)
    row = db.execute(stmt.with_for_update()).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)

    title = _valid_title(req.title)
    initial = req.initial_balance if req.initial_balance is not None else row.initial_balance
    if not initial.is_finite() or initial < -_MAX_BALANCE or initial > _MAX_BALANCE or initial * 10 != (initial * 10).to_integral_value():
        raise AppError("INVALID_INITIAL_BALANCE", "موجودی نامعتبر است.", 422)
    if initial != row.initial_balance:
        raise AppError("BALANCE_CORRECTION_REQUIRED", "برای تغییر موجودی از اصلاح موجودی استفاده کنید؛ ویرایش مشخصات مبلغ را تغییر نمی‌دهد.", 409)

    card = _normalize_card(req.card_number)
    if card != row.card_number and not req.confirm_card_change:
        raise AppError("ACCOUNT_CONFIRMATION_REQUIRED", "تغییر شماره کارت را تأیید کنید.", 422)
    if row.kind == "bank" and card is None:
        raise AppError("EMPTY_ACCOUNT", "حساب بانکی باید شماره کارت داشته باشد.", 422)
    _check_bin(db, card, req.bank)

    row.title = title
    row.bank = (req.bank or "").strip() or None
    row.card_number = card
    row.initial_balance = initial
    db.commit()
    db.refresh(row)
    return row


def delete(
    db: Session, actor: Member, account_id: uuid.UUID, confirmation: str | None = None
) -> None:
    """Only its owner may delete an unused account after confirming its current name."""
    lock_financial_family(db, actor.family_id)
    stmt = select(Account).where(Account.id == account_id, Account.family_id == actor.family_id)
    stmt = stmt.where(Account.member_id == actor.id)
    row = db.execute(stmt.with_for_update()).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)
    if confirmation != row.title:
        raise AppError(
            "ACCOUNT_CONFIRMATION_REQUIRED", "برای تأیید حذف، نام حساب را دقیق وارد کنید.", 422
        )
    from app.services.wallet_corrections import list_history
    if list_history(db, actor, account_id):
        raise AppError("ACCOUNT_IN_USE", "این حساب سابقهٔ اصلاح موجودی دارد و حذف نمی‌شود.", 409)
    if db.scalar(text("SELECT public.wallet_account_has_transactions(:aid)"), {"aid": account_id}):
        raise AppError(
            "ACCOUNT_IN_USE", "این حساب سابقهٔ تراکنش دارد و حذف نمی‌شود؛ سابقهٔ مالی حفظ می‌شود.", 409
        )
    db.delete(row)
    db.commit()
