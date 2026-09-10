"""حساب‌ها/کارت‌ها: خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

معادلِ add/update/delete_account قدیمی با همان کدهای خطا. هم‌خوانیِ ۶ رقمِ اولِ
کارت (BIN) با بانکِ انتخاب‌شده عیناً حفظ شده است. نوعِ حساب (kind) هنگام ویرایش
تغییرناپذیر است؛ ویرایش موجودی منفی هم می‌پذیرد (کلاینت «موجودی فعلی» را ویرایش
می‌کند و موجودی اولیه ممکن است منفی شود).
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.account import Account, CardBin
from app.models.family import Member
from app.schemas.data import AccountCreate, AccountUpdate
from app.services.common import to_uuid

_MAX_BALANCE = 999999999999999  # ۱۵ نُه — هم‌سان با add/update_account قدیمی


# ── خواندن (فاز ۶) ───────────────────────────────────────────
def list_for_family(db: Session, family_id: uuid.UUID) -> list[Account]:
    return list(
        db.execute(
            select(Account)
            .where(Account.family_id == family_id)
            .order_by(Account.created_at.asc())
        ).scalars()
    )


# ── کمک‌تابع‌ها ──────────────────────────────────────────────
def _normalize_card(raw: str | None) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return None
    if not re.fullmatch(r"\d{16}", digits):
        raise AppError("INVALID_CARD", "شماره کارت باید ۱۶ رقم باشد.", 422)
    return digits


def _check_bin(db: Session, card: str | None, bank: str | None) -> None:
    """هم‌خوانیِ ۶ رقمِ اولِ کارت با بانکِ انتخاب‌شده — عیناً مثلِ RPC قدیمی."""
    bank_t = (bank or "").strip()
    if card is None or not bank_t:
        return
    first6 = card[:6]
    # کارتِ این BIN متعلق به بانکِ دیگری است
    if db.execute(
        select(CardBin.bin).where(CardBin.bin == first6, CardBin.bank != bank_t).limit(1)
    ).first() is not None:
        raise AppError("BANK_MISMATCH", "شماره کارت با بانکِ انتخاب‌شده هم‌خوان نیست.", 422)
    # بانکِ انتخابی اصلاً BIN ندارد ولی BINِ کارت شناخته‌شده و مالِ بانکِ دیگری است
    bank_has_bin = db.execute(
        select(CardBin.bin).where(CardBin.bank == bank_t).limit(1)
    ).first() is not None
    first6_known = db.execute(
        select(CardBin.bin).where(CardBin.bin == first6).limit(1)
    ).first() is not None
    if not bank_has_bin and first6_known:
        raise AppError("BANK_MISMATCH", "شماره کارت با بانکِ انتخاب‌شده هم‌خوان نیست.", 422)


def _valid_title(title: str | None) -> str:
    t = (title or "").strip()
    if not t or len(t) > 40:
        raise AppError("INVALID_TITLE", "نامِ حساب نامعتبر است.", 422)
    return t


# ── افزودن / ویرایش / حذف ────────────────────────────────────
def create(db: Session, family_id: uuid.UUID, req: AccountCreate) -> Account:
    kind = (req.kind or "").strip() or "bank"
    if kind not in ("bank", "wallet"):
        raise AppError("INVALID_KIND", "نوعِ حساب نامعتبر است.", 422)
    title = _valid_title(req.title)

    member_id = to_uuid(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if db.execute(
        select(Member.id).where(Member.id == member_id, Member.family_id == family_id).limit(1)
    ).first() is None:
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    initial = req.initial_balance if req.initial_balance is not None else 0
    if initial < 0 or initial > _MAX_BALANCE:
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
    # ردیفِ فعلی + بررسیِ مجوز در یک مرحله (مدیر هر کارت / عضو کارتِ خودش)
    stmt = select(Account).where(
        Account.id == account_id, Account.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(Account.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)

    title = _valid_title(req.title)
    initial = req.initial_balance if req.initial_balance is not None else row.initial_balance
    if initial < -_MAX_BALANCE or initial > _MAX_BALANCE:
        raise AppError("INVALID_INITIAL_BALANCE", "موجودی نامعتبر است.", 422)

    card = _normalize_card(req.card_number)
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


def delete(db: Session, actor: Member, account_id: uuid.UUID) -> None:
    """حذف: مدیر هر کارتِ خانواده؛ عضو فقط کارتِ خودش."""
    stmt = select(Account).where(
        Account.id == account_id, Account.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(Account.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "حساب یافت نشد.", 404)
    db.delete(row)
    db.commit()
