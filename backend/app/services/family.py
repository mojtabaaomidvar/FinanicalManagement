"""خانواده و اعضا: اعتبارسنجی نشست، دعوت، افزودن/حذف عضو.

همهٔ این عملیات‌ها با «عضوِ احراز‌هویت‌شده از توکن» کار می‌کنند (لایهٔ deps) و مرزِ
خانواده را از family_id همان عضو می‌گیرند — نه از ورودی کلاینت.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import hash_password
from app.models.auth import FamilyInvite, Session as SessionModel
from app.models.family import Family, Member
from app.schemas.auth import (
    AcceptInviteRequest,
    AuthResult,
    FamilyOut,
    InviteInfo,
    MemberPublic,
    SessionPayload,
)
from app.schemas.data import FamilySettingsUpdate, MemberProfileUpdate
from app.services import otp as otp_service
from app.services import sessions
from app.services.clock import utcnow

_INVITE_TTL_DAYS = 30
_INVITE_TOKEN_LEN = 40
_THEMES = {"light", "dark", "auto"}
_CURRENCIES = {"تومان", "ریال"}
_MEMBER_NAME_MAX = 40


# ── خواندن خانواده/اعضا ──────────────────────────────────────
def family_of(db: Session, family_id: uuid.UUID) -> Family:
    family = db.get(Family, family_id)
    if family is None:
        raise AppError("NOT_FOUND", "خانواده یافت نشد.", 404)
    return family


def members_of(db: Session, family_id: uuid.UUID) -> list[Member]:
    return list(
        db.execute(
            select(Member)
            .where(Member.family_id == family_id)
            .order_by(Member.created_at.asc())
        ).scalars()
    )


def validate_session_payload(db: Session, member: Member) -> SessionPayload:
    """عضو جاری + خانواده + همهٔ اعضا — یک درخواست برای ورود به اپ."""
    family = family_of(db, member.family_id)
    members = members_of(db, member.family_id)
    return SessionPayload(
        member=MemberPublic.of(member),
        family=FamilyOut.of(family),
        members=[MemberPublic.of(m) for m in members],
    )


# ── دعوت ─────────────────────────────────────────────────────
def create_invite(db: Session, family_id: uuid.UUID, created_by: uuid.UUID) -> str:
    """دعوت فعالِ قبلی غیرفعال می‌شود و توکن تازه (۴۰ هگز، ۳۰ روزه) ساخته می‌شود."""
    db.execute(
        update(FamilyInvite)
        .where(FamilyInvite.family_id == family_id, FamilyInvite.active.is_(True))
        .values(active=False)
    )
    token = secrets.token_hex(_INVITE_TOKEN_LEN // 2)  # ۴۰ کاراکتر هگز
    db.add(
        FamilyInvite(
            family_id=family_id,
            token=token,
            created_by=created_by,
            expires_at=utcnow() + timedelta(days=_INVITE_TTL_DAYS),
        )
    )
    db.commit()
    return token


def _active_invite(db: Session, token: str) -> FamilyInvite:
    inv = db.execute(
        select(FamilyInvite)
        .where(
            FamilyInvite.token == token,
            FamilyInvite.active.is_(True),
            FamilyInvite.expires_at > utcnow(),
        )
        .limit(1)
    ).scalar_one_or_none()
    if inv is None:
        raise AppError("INVALID_INVITE", "لینک دعوت نامعتبر یا منقضی است.", 404)
    return inv


def get_invite(db: Session, token: str) -> InviteInfo:
    inv = _active_invite(db, token)
    family = family_of(db, inv.family_id)
    return InviteInfo(family_name=family.name)


def accept_invite(db: Session, req: AcceptInviteRequest) -> AuthResult:
    if req.password is None or len(req.password) < 8:
        raise AppError("WEAK_PASSWORD", "رمز عبور باید حداقل ۸ کاراکتر باشد.", 422)

    relation = (req.relation or "").strip()
    if not relation:
        raise AppError("EMPTY_RELATION", "نسبت را مشخص کنید.", 422)

    otp_service.consume_otp(db, req.phone, req.otp_code)

    inv = _active_invite(db, req.invite_token)

    exists = db.execute(
        select(Member.id).where(Member.phone == req.phone).limit(1)
    ).first()
    if exists is not None:
        raise AppError("PHONE_EXISTS", "این شماره قبلاً ثبت شده است.", 409)

    member = Member(
        family_id=inv.family_id,
        name=req.member_name,
        role="member",
        phone=req.phone,
        password_hash=hash_password(req.password),
        relation=relation,
    )
    db.add(member)
    db.commit()

    family = family_of(db, inv.family_id)
    token = sessions.create_session(db, member.id)
    return AuthResult(
        member=MemberPublic.of(member),
        family=FamilyOut.of(family),
        session_token=token,
    )


# ── مدیریت اعضا (فقط مدیر) ───────────────────────────────────
def add_member_by_manager(
    db: Session, actor: Member, name: str, phone: str, relation: str
) -> MemberPublic:
    """افزودن عضوِ pending (اسم/شماره/نسبت) — تا خودش ثبت‌نام کند. فقط مدیر."""
    if actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)

    name = (name or "").strip()
    if not (1 <= len(name) <= 40):
        raise AppError("INVALID_NAME", "نام نامعتبر است.", 422)
    relation = (relation or "").strip()
    if not relation:
        raise AppError("INVALID_RELATION", "نسبت را مشخص کنید.", 422)

    exists = db.execute(
        select(Member.id).where(Member.phone == phone).limit(1)
    ).first()
    if exists is not None:
        raise AppError("PHONE_EXISTS", "این شماره قبلاً ثبت شده است.", 409)

    member = Member(
        family_id=actor.family_id,
        name=name,
        role="member",
        phone=phone,
        status="pending",
        relation=relation,
    )
    db.add(member)
    db.commit()
    return MemberPublic.of(member)


def remove_member(db: Session, actor: Member, member_id: uuid.UUID) -> None:
    """حذف عضو (فقط مدیر؛ مدیر قابل حذف نیست)؛ نشست‌های او هم باطل می‌شوند."""
    target = db.get(Member, member_id)
    if target is None or target.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    if target.role == "owner":
        raise AppError("CANNOT_REMOVE_OWNER", "مدیر خانواده قابل حذف نیست.", 409)

    db.execute(delete(SessionModel).where(SessionModel.member_id == target.id))
    db.delete(target)
    db.commit()


# ── تنظیماتِ خانواده و پروفایلِ عضو (فاز ۷ — بیرون از RLS) ────
# این عملیات‌ها روی جدول‌های هویتی (families/members) کار می‌کنند که از RLS مستثنا
# هستند؛ پس مرزِ مستأجر در «لایهٔ اپ» اعمال می‌شود: هر نوشتن یا به خودِ actor محدود
# است یا صریحاً family_id عضوِ هدف با actor سنجیده می‌شود.
def update_family_settings(db: Session, owner: Member, req: FamilySettingsUpdate) -> None:
    """تعیینِ سقفِ بودجهٔ ماهانهٔ خانواده — فقط مدیر.

    فقط budget اعمال می‌شود (منفی/None → صفر)؛ currency/dark عمداً نادیده گرفته
    می‌شوند چون واحد پول و تم اکنون «شخصی»‌اند (هم‌سان با update_family_settings v5.8).
    """
    if owner.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    family = family_of(db, owner.family_id)
    val = req.budget if req.budget is not None else Decimal(0)
    if val < 0:
        val = Decimal(0)
    family.budget = val
    db.commit()


def update_member_profile(db: Session, actor: Member, req: MemberProfileUpdate) -> Member:
    """به‌روزرسانیِ پروفایلِ «خودِ» عضو (نام/جنسیت/تولد/آواتار/تم).

    نام الزامی (۱..۴۰)؛ جنسیتِ نامعتبر → NULL؛ تمِ نامعتبر/خالی → بدون تغییر.
    """
    name = (req.name or "").strip()
    if not (1 <= len(name) <= _MEMBER_NAME_MAX):
        raise AppError("INVALID_NAME", "نام باید ۱ تا ۴۰ کاراکتر باشد.", 422)
    actor.name = name
    gender = (req.gender or "").strip().lower()
    actor.gender = gender if gender in ("male", "female") else None
    actor.birth_date = req.birth_date
    # national_id حذف شد (درخواست مالک ۲۰۲۶-۰۹-۰۸): کدملی دیگر نوشته نمی‌شود.
    avatar_url = (req.avatar_url or "").strip()
    actor.avatar_url = avatar_url or None
    theme = (req.theme or "").strip()
    if theme in _THEMES:
        actor.theme = theme
    db.commit()
    db.refresh(actor)
    return actor


def set_member_theme(db: Session, actor: Member, theme: str | None) -> None:
    """تعیینِ تمِ نمایشِ «خودِ» عضو (light/dark/auto)."""
    t = (theme or "").strip()
    if t not in _THEMES:
        raise AppError("INVALID_THEME", "تمِ نمایش نامعتبر است.", 422)
    actor.theme = t
    db.commit()


def set_member_currency(db: Session, actor: Member, currency: str | None) -> Member:
    """تعیینِ واحدِ پولِ نمایشیِ «خودِ» عضو (تومان/ریال). مبالغ همیشه به تومان ذخیره‌اند."""
    c = (currency or "").strip()
    if c not in _CURRENCIES:
        raise AppError("INVALID_CURRENCY", "واحد پول نامعتبر است.", 422)
    actor.currency = c
    db.commit()
    db.refresh(actor)
    return actor


def set_member_relation(
    db: Session, actor: Member, member_id: uuid.UUID, relation: str | None
) -> Member:
    """تعیینِ نسبتِ یک عضو. مدیر می‌تواند نسبتِ هر عضو را تغییر دهد؛ عضوِ عادی فقط
    نسبتِ خودش را. نسبتِ «مدیر» ثابت است (OWNER_RELATION_FIXED)."""
    target = db.get(Member, member_id)
    if target is None or target.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if target.role == "owner":
        raise AppError("OWNER_RELATION_FIXED", "نسبتِ مدیر خانواده ثابت است.", 409)
    if actor.role != "owner" and target.id != actor.id:
        raise AppError("FORBIDDEN", "اجازهٔ تغییر نسبتِ این عضو را ندارید.", 403)
    rel = (relation or "").strip()
    if not rel:
        raise AppError("EMPTY_RELATION", "نسبت را مشخص کنید.", 422)
    target.relation = rel
    db.commit()
    db.refresh(target)
    return target
