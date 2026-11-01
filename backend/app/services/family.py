"""خانواده و اعضا: اعتبارسنجی نشست، دعوت، افزودن/حذف عضو.

همهٔ این عملیات‌ها با «عضو احراز‌هویت‌شده از توکن» کار می‌کنند (لایهٔ deps) و مرز
خانواده را از family_id همان عضو می‌گیرند — نه از ورودی کلاینت.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import hash_password
from app.db.rls import bind_family_to_session
from app.models.auth import FamilyInvite, Session as SessionModel
from app.models.family import Family, Member
from app.models.join_request import JoinRequest
from app.schemas.auth import (
    AcceptInviteRequest,
    FamilyOut,
    InviteInfo,
    JoinByCodeRequest,
    JoinPendingResult,
    JoinRequestOut,
    MemberPublic,
    SessionPayload,
)
from app.schemas.data import FamilySettingsUpdate, MemberProfileUpdate
from app.services import otp as otp_service
from app.services import ratelimit
from app.services.clock import utcnow
from app.services.common import is_admin

_INVITE_TTL_DAYS = 30
_INVITE_TOKEN_LEN = 40
_THEMES = {"light", "dark", "auto"}
_CURRENCIES = {"تومان", "ریال"}
_MEMBER_NAME_MAX = 40
_MAX_ADMINS = 2  # §2.3 — حداکثر دو مدیر در هر خانواده

# IPِ نامعلوم (فراخوانیِ درون‌فرایندی) → سطلِ مشترک، یعنی سقفِ سخت‌گیرانه‌تر.
_UNKNOWN_IP = "unknown"


def _limit_join_probe(db: Session, ip: str) -> None:
    """سقفِ per-IP روی هر سه مسیرِ «پیوستن» — رفعِ شکافِ #۱۵ (§5.11).

    چرا یک سطلِ مشترک برای لینک و کد؟ چون حفرهٔ اصلی **کدِ ۶ رقمیِ خانواده** است:
    فضای جست‌وجو فقط یک‌میلیون است و `POST /auth/join` هیچ گیتی نداشت، پس یک
    اسکریپت می‌توانست کدها را بشمارد تا به خانوادهٔ واقعی برسد. سقفِ per-phone
    (`auth_attempts`) اینجا بی‌اثر است چون مهاجم شمارهٔ خودش را می‌فرستد و کد را
    عوض می‌کند.

    `get_invite` هم در همین سطل است تا مهاجم نتواند با «فقط خواندنِ» اطلاعاتِ دعوت،
    نامِ خانواده‌ها را برداشت کند.
    """
    ratelimit.hit(db, "join", ip, limit=settings.rl_join_per_ip)


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
    """دعوت فعال قبلی غیرفعال می‌شود و توکن تازه (۴۰ هگز، ۳۰ روزه) ساخته می‌شود."""
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


def get_invite(db: Session, token: str, *, ip: str = _UNKNOWN_IP) -> InviteInfo:
    _limit_join_probe(db, ip)
    inv = _active_invite(db, token)
    family = family_of(db, inv.family_id)
    return InviteInfo(family_name=family.name)


def _register_pending_joiner(
    db: Session,
    *,
    family_id: uuid.UUID,
    member_name: str,
    phone: str,
    password: str | None,
    otp_code: str | None,
    relation: str | None,
    via: str,
    invite_id: uuid.UUID | None,
) -> Member:
    """کارِ مشترکِ «پیوستن» (لینک یا کد): ساختِ عضوِ pending + یک join_request.

    عضو با membership_state='pending' ساخته می‌شود و **نشست نمی‌گیرد** (§2.6 — رفعِ
    #۲). زمینهٔ خانواده از منبعِ سرور-تأییدشده (دعوت/کد) صریح بسته می‌شود تا INSERTِ
    join_request زیرِ RLS رد نشود. commit به‌عهدهٔ صداکننده است.
    """
    if password is None or len(password) < 8:
        raise AppError("WEAK_PASSWORD", "رمز عبور باید حداقل ۸ کاراکتر باشد.", 422)
    name = (member_name or "").strip()
    if not (1 <= len(name) <= _MEMBER_NAME_MAX):
        raise AppError("INVALID_NAME", "نام باید ۱ تا ۴۰ کاراکتر باشد.", 422)
    rel = (relation or "").strip()
    if not rel:
        raise AppError("EMPTY_RELATION", "نسبت را مشخص کنید.", 422)

    otp_service.consume_otp(db, phone, otp_code)

    exists = db.execute(
        select(Member.id).where(Member.phone == phone).limit(1)
    ).first()
    if exists is not None:
        raise AppError("PHONE_EXISTS", "این شماره قبلاً ثبت شده است.", 409)

    # زمینهٔ خانواده از توکنِ سرور-تأییدشده (نه از کلاینت) → WITH CHECK برقرار می‌ماند.
    bind_family_to_session(db, family_id)

    member = Member(
        family_id=family_id,
        name=name,
        role="member",
        phone=phone,
        password_hash=hash_password(password),
        relation=rel,
        membership_state="pending",  # status پیش‌فرض 'active' = خودش ثبت‌نام کرده
    )
    db.add(member)
    db.flush()  # برای در دست داشتن member.id
    db.add(
        JoinRequest(
            family_id=family_id,
            member_id=member.id,
            via=via,
            invite_id=invite_id,
            state="pending",
        )
    )
    return member


def accept_invite(
    db: Session, req: AcceptInviteRequest, *, ip: str = _UNKNOWN_IP
) -> JoinPendingResult:
    """پذیرشِ لینکِ دعوت: درخواستِ pending می‌سازد، توکن را می‌سوزاند، **نشست نمی‌دهد**."""
    _limit_join_probe(db, ip)
    inv = _active_invite(db, req.invite_token)
    member = _register_pending_joiner(
        db,
        family_id=inv.family_id,
        member_name=req.member_name,
        phone=req.phone,
        password=req.password,
        otp_code=req.otp_code,
        relation=req.relation,
        via="link",
        invite_id=inv.id,
    )
    # تک‌مصرفه‌سازی (رفعِ #۳): لینک سوزانده می‌شود.
    inv.active = False
    inv.used_at = utcnow()
    inv.used_by = member.id
    db.commit()
    family = family_of(db, inv.family_id)
    return JoinPendingResult(family_name=family.name)


def join_by_code(
    db: Session, req: JoinByCodeRequest, *, ip: str = _UNKNOWN_IP
) -> JoinPendingResult:
    """پیوستن با کدِ ۶ رقمیِ خانواده (§2.6): جریانِ pending، بدونِ نشست."""
    _limit_join_probe(db, ip)
    family = db.execute(
        select(Family).where(Family.code == req.code).limit(1)
    ).scalar_one_or_none()
    if family is None:
        raise AppError("INVALID_CODE", "کد خانواده نامعتبر است.", 404)
    _register_pending_joiner(
        db,
        family_id=family.id,
        member_name=req.member_name,
        phone=req.phone,
        password=req.password,
        otp_code=req.otp_code,
        relation=req.relation,
        via="code",
        invite_id=None,
    )
    db.commit()
    return JoinPendingResult(family_name=family.name)


# ── تأییدِ عضویت (فقط مدیر؛ زمینهٔ RLS بسته است) ──────────────
def list_join_requests(db: Session, actor: Member) -> list[JoinRequestOut]:
    """درخواست‌های پیوستنِ در انتظارِ خانواده — با نام/شماره/نسبتِ متقاضی."""
    rows = db.execute(
        select(JoinRequest, Member)
        .join(Member, Member.id == JoinRequest.member_id, isouter=True)
        .where(
            JoinRequest.family_id == actor.family_id,
            JoinRequest.state == "pending",
        )
        .order_by(JoinRequest.requested_at.asc())
    ).all()
    out: list[JoinRequestOut] = []
    for jr, m in rows:
        out.append(
            JoinRequestOut(
                id=str(jr.id),
                member_id=str(jr.member_id) if jr.member_id else None,
                member_name=m.name if m else None,
                phone=m.phone if m else None,
                relation=m.relation if m else None,
                via=jr.via,
                state=jr.state,
                requested_at=jr.requested_at,
            )
        )
    return out


def _pending_request(db: Session, actor: Member, request_id: uuid.UUID) -> JoinRequest:
    jr = db.get(JoinRequest, request_id)  # زیرِ RLS: فقط همان خانواده دیده می‌شود
    if jr is None or jr.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "درخواست یافت نشد.", 404)
    if jr.state != "pending":
        raise AppError("ALREADY_DECIDED", "این درخواست قبلاً بررسی شده است.", 409)
    return jr


def approve_join_request(db: Session, actor: Member, request_id: uuid.UUID) -> MemberPublic:
    """تأیید: عضویتِ متقاضی ACTIVE می‌شود؛ از این پس می‌تواند وارد شود."""
    jr = _pending_request(db, actor, request_id)
    member = db.get(Member, jr.member_id) if jr.member_id else None
    if member is None or member.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    member.membership_state = "active"
    jr.state = "approved"
    jr.decided_by = actor.id
    jr.decided_at = utcnow()
    db.commit()
    db.refresh(member)
    return MemberPublic.of(member)


def reject_join_request(db: Session, actor: Member, request_id: uuid.UUID) -> None:
    """رد: عضویت rejected می‌شود (ورود ممنوع؛ ردیف برای ممیزی می‌ماند)."""
    jr = _pending_request(db, actor, request_id)
    member = db.get(Member, jr.member_id) if jr.member_id else None
    if member is not None and member.family_id == actor.family_id:
        member.membership_state = "rejected"
    jr.state = "rejected"
    jr.decided_by = actor.id
    jr.decided_at = utcnow()
    db.commit()


# ── نقشِ مدیر: ارتقا/تنزل (§2.3/§2.4) ─────────────────────────
def _active_admin_count(db: Session, family_id: uuid.UUID) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Member)
            .where(
                Member.family_id == family_id,
                Member.role.in_(("owner", "admin")),
                Member.membership_state == "active",
            )
        ).scalar_one()
    )


def promote_member(db: Session, actor: Member, member_id: uuid.UUID) -> MemberPublic:
    """ارتقای یک عضوِ ACTIVE به مدیر (admin) — با گاردِ حداکثر ۲ مدیر."""
    if not is_admin(actor):
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    target = db.get(Member, member_id)
    if target is None or target.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if target.membership_state != "active":
        raise AppError("MEMBER_NOT_ACTIVE", "فقط عضوِ فعال می‌تواند مدیر شود.", 409)
    if is_admin(target):
        return MemberPublic.of(target)  # از قبل مدیر است (idempotent)
    if _active_admin_count(db, actor.family_id) >= _MAX_ADMINS:
        raise AppError("TOO_MANY_ADMINS", "حداکثر دو مدیر در هر خانواده مجاز است.", 409)
    target.role = "admin"
    db.commit()
    db.refresh(target)
    return MemberPublic.of(target)


def demote_member(db: Session, actor: Member, member_id: uuid.UUID) -> MemberPublic:
    """تنزلِ یک مدیرِ دوم به عضوِ عادی. سازنده (created_by) قابل تنزل نیست."""
    if not is_admin(actor):
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    family = family_of(db, actor.family_id)
    target = db.get(Member, member_id)
    if target is None or target.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if family.created_by is not None and target.id == family.created_by:
        raise AppError("CANNOT_DEMOTE_CREATOR", "سازندهٔ خانواده قابل تنزل نیست.", 409)
    if not is_admin(target):
        return MemberPublic.of(target)  # از قبل عضوِ عادی است (idempotent)
    target.role = "member"
    db.commit()
    db.refresh(target)
    return MemberPublic.of(target)


# ── مدیریت اعضا (فقط مدیر) ───────────────────────────────────
def add_member_by_manager(
    db: Session, actor: Member, name: str, phone: str, relation: str
) -> MemberPublic:
    """افزودن عضو pending (اسم/شماره/نسبت) — تا خودش ثبت‌نام کند. فقط مدیر."""
    if not is_admin(actor):
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
    if not is_admin(actor):
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    if target.role == "owner":
        raise AppError("CANNOT_REMOVE_OWNER", "مدیر خانواده قابل حذف نیست.", 409)

    db.execute(delete(SessionModel).where(SessionModel.member_id == target.id))
    db.delete(target)
    db.commit()


# ── تنظیمات خانواده و پروفایل عضو (فاز ۷ — بیرون از RLS) ────
# این عملیات‌ها روی جدول‌های هویتی (families/members) کار می‌کنند که از RLS مستثنا
# هستند؛ پس مرز مستأجر در «لایهٔ اپ» اعمال می‌شود: هر نوشتن یا به خود actor محدود
# است یا صریحاً family_id عضو هدف با actor سنجیده می‌شود.
def update_family_settings(db: Session, owner: Member, req: FamilySettingsUpdate) -> None:
    """تعیین سقف بودجهٔ ماهانهٔ خانواده — فقط مدیر.

    فقط budget اعمال می‌شود (منفی/None → صفر)؛ currency/dark عمداً نادیده گرفته
    می‌شوند چون واحد پول و تم اکنون «شخصی»‌اند (هم‌سان با update_family_settings v5.8).
    """
    if not is_admin(owner):
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    family = family_of(db, owner.family_id)
    val = req.budget if req.budget is not None else Decimal(0)
    if val < 0:
        val = Decimal(0)
    family.budget = val
    db.commit()


def update_member_profile(db: Session, actor: Member, req: MemberProfileUpdate) -> Member:
    """به‌روزرسانی پروفایل «خود» عضو (نام/جنسیت/تولد/آواتار/تم).

    نام الزامی (۱..۴۰)؛ جنسیت نامعتبر → NULL؛ تم نامعتبر/خالی → بدون تغییر.
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
    """تعیین تم نمایش «خود» عضو (light/dark/auto)."""
    t = (theme or "").strip()
    if t not in _THEMES:
        raise AppError("INVALID_THEME", "تم نمایش نامعتبر است.", 422)
    actor.theme = t
    db.commit()


def set_member_currency(db: Session, actor: Member, currency: str | None) -> Member:
    """تعیین واحد پول نمایشی «خود» عضو (تومان/ریال). مبالغ همیشه به تومان ذخیره‌اند."""
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
    """تعیین نسبت یک عضو. مدیر می‌تواند نسبت هر عضو را تغییر دهد؛ عضو عادی فقط
    نسبت خودش را. نسبت «مدیر» ثابت است (OWNER_RELATION_FIXED)."""
    target = db.get(Member, member_id)
    if target is None or target.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if target.role == "owner":
        raise AppError("OWNER_RELATION_FIXED", "نسبت مدیر خانواده ثابت است.", 409)
    if not is_admin(actor) and target.id != actor.id:
        raise AppError("FORBIDDEN", "اجازهٔ تغییر نسبت این عضو را ندارید.", 403)
    rel = (relation or "").strip()
    if not rel:
        raise AppError("EMPTY_RELATION", "نسبت را مشخص کنید.", 422)
    target.relation = rel
    db.commit()
    db.refresh(target)
    return target
