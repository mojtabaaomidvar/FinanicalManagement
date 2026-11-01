"""هستهٔ احراز هویت: ورود، ثبت‌نام، تغییر رمز، پیش‌ثبت، پیکربندی عمومی.

اصل ثابت: توکن نشست فقط از هدر می‌آید (لایهٔ deps)؛ این سرویس هرگز توکن را از
بدنه نمی‌خواند. شناخت شماره‌ی صحیح به‌تنهایی نشست نمی‌دهد — رمز در سرور بررسی می‌شود.
"""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import hash_password
from app.models.family import Family, Member
from app.schemas.auth import (
    AuthResult,
    FamilyOut,
    MemberPublic,
    PreRegisteredResult,
    PublicConfig,
    RegisterRequest,
)
from app.services import otp as otp_service
from app.services import password_reset, passwords, ratelimit, sessions

_MIN_PASSWORD = 8
_PRE_REG_MAX_PER_MINUTE = 60  # سطل سراسری (نه per-phone) — ضد «شمارش شماره‌ها»

# مقدارِ پیش‌فرضِ IP برای فراخوانی‌های درون‌فرایندی (تست‌ها، اسکریپت‌ها). یک سطلِ
# مشترک می‌سازد، پس سقف سخت‌گیرانه‌تر می‌شود نه بازتر.
_UNKNOWN_IP = "unknown"


# ── پیکربندی عمومی ───────────────────────────────────────────
def public_config(db: Session) -> PublicConfig:
    return PublicConfig(
        otp_enabled=otp_service.is_otp_enabled(db),
        password_reset_enabled=password_reset.is_available(),
    )


# ── بررسی رمز (مرحلهٔ ۱ فرم ورود) ────────────────────────────
def check_password(db: Session, phone: str, password: str, *, ip: str = _UNKNOWN_IP) -> bool:
    """بررسیِ رمز بی‌ساختِ نشست (قدمِ اولِ فرمِ ورود).

    سقفِ per-IP اینجا هم لازم است: `check_password_gated` با **شماره** کلید می‌خورد،
    پس مهاجمی که یک رمزِ رایج را روی هزار شمارهٔ مختلف می‌آزماید هیچ‌گاه به قفلِ
    per-phone نمی‌خورد (§5.11 — «credential-stuffing protection»).
    """
    ratelimit.hit(db, "check_password", ip, limit=settings.rl_check_password_per_ip)
    return passwords.check_password_gated(db, phone, password)


# ── گیتِ عضویت هنگام ورود (§2.5/§2.6) ─────────────────────────
# فقط عضوِ ACTIVE نشست می‌گیرد. عضوی که با لینک/کد «پیوسته» ولی هنوز تأیید نشده
# status='active' دارد (خودش ثبت‌نام کرده) امّا membership_state='pending' است؛ پس
# همین گیت جلوی ورودش را تا تأییدِ مدیر می‌گیرد. اعضای پیش از مهاجرت همه 'active'
# بک‌فیل شدند، پس رفتارشان تغییری نمی‌کند.
_LOGIN_MEMBERSHIP_MESSAGES: dict[str, tuple[str, str]] = {
    "pending": (
        "MEMBERSHIP_PENDING",
        "عضویت شما هنوز تأیید نشده است؛ لطفاً منتظرِ تأییدِ مدیرِ خانواده بمانید.",
    ),
    "rejected": ("MEMBERSHIP_REJECTED", "درخواستِ عضویتِ شما رد شده است."),
}


def _ensure_can_login(member: Member) -> None:
    """فقط عضوِ ACTIVE می‌تواند نشست بگیرد؛ pending/rejected/… مسدودند."""
    state = member.membership_state
    if state == "active":
        return
    code, message = _LOGIN_MEMBERSHIP_MESSAGES.get(
        state, ("MEMBERSHIP_INACTIVE", "عضویت شما در خانواده فعال نیست.")
    )
    raise AppError(code, message, 403)


# ── ورود ─────────────────────────────────────────────────────
def login(
    db: Session, phone: str, password: str, code: str | None, *, ip: str = _UNKNOWN_IP
) -> AuthResult:
    # سقفِ مبدأ پیش از هر کارِ گران‌قیمت (هشِ Argon2id ده‌ها میلی‌ثانیه CPU می‌برد؛
    # بی این سقف، خودِ ورود به اهرمِ DoS بدل می‌شود).
    ratelimit.hit(db, "login", ip, limit=settings.rl_login_per_ip)

    if not passwords.check_password_gated(db, phone, password):
        raise AppError("INVALID_CREDENTIALS", "شماره یا رمز عبور نادرست است.", 401)

    otp_service.consume_otp(db, phone, code)

    member = db.execute(
        select(Member).where(Member.phone == phone).limit(1)
    ).scalar_one_or_none()
    if member is None:
        raise AppError("NO_MEMBER", "کاربری با این شماره یافت نشد.", 404)

    _ensure_can_login(member)

    family = db.get(Family, member.family_id)
    token = sessions.create_session(db, member.id)
    return AuthResult(
        member=MemberPublic.of(member),
        family=FamilyOut.of(family),
        session_token=token,
    )


# ── ثبت‌نام ──────────────────────────────────────────────────
def _generate_family_code(db: Session) -> str:
    """کد ۶ رقمی یکتای خانواده (حلقه تا نبود تکراری)."""
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        exists = db.execute(
            select(Family.id).where(Family.code == code).limit(1)
        ).first()
        if exists is None:
            return code


def register(db: Session, req: RegisterRequest, *, ip: str = _UNKNOWN_IP) -> AuthResult:
    # سقفِ مبدأ: بی آن، یک اسکریپت می‌تواند هزاران «خانواده» بسازد و جدولِ families
    # را پر کند (هر ثبت‌نام یک هشِ Argon2id هم هست).
    ratelimit.hit(db, "register", ip, limit=settings.rl_register_per_ip)

    if req.password is None or len(req.password) < _MIN_PASSWORD:
        raise AppError("WEAK_PASSWORD", "رمز عبور باید حداقل ۸ کاراکتر باشد.", 422)

    otp_service.consume_otp(db, req.phone, req.otp_code)

    relation = (req.relation or "").strip()
    if not relation:
        raise AppError("INVALID_RELATION", "نسبت را مشخص کنید.", 422)

    existing = db.execute(
        select(Member).where(Member.phone == req.phone).limit(1)
    ).scalar_one_or_none()

    if existing is not None:
        if existing.status != "pending":
            raise AppError("PHONE_EXISTS", "این شماره قبلاً ثبت شده است.", 409)
        # تکمیل ثبت‌نام عضو معرفی‌شده توسط مدیر
        name = (req.member_name or "").strip() or existing.name
        existing.name = name
        existing.password_hash = hash_password(req.password)
        existing.status = "active"
        existing.relation = relation
        db.commit()
        family = db.get(Family, existing.family_id)
        token = sessions.create_session(db, existing.id)
        return AuthResult(
            member=MemberPublic.of(existing),
            family=FamilyOut.of(family),
            session_token=token,
        )

    # خانوادهٔ تازه + عضو اول (مدیر؛ نسبت همیشه «خودم»)
    family = Family(name=req.family_name.strip(), code=_generate_family_code(db))
    db.add(family)
    db.flush()  # برای در دست داشتن family.id
    owner = Member(
        family_id=family.id,
        name=req.member_name.strip(),
        role="owner",
        phone=req.phone,
        password_hash=hash_password(req.password),
        relation="خودم",
    )
    db.add(owner)
    db.flush()  # برای در دست داشتن owner.id
    family.created_by = owner.id  # سازندهٔ خانواده (§2.4) — جدا از نقش، غیرقابلِ تنزل
    db.commit()

    token = sessions.create_session(db, owner.id)
    return AuthResult(
        member=MemberPublic.of(owner),
        family=FamilyOut.of(family),
        session_token=token,
    )


# ── تغییر رمز ────────────────────────────────────────────────
def change_password(
    db: Session,
    member: Member,
    current_password: str,
    new_password: str,
    current_raw_token: str,
) -> None:
    # تأیید رمز فعلی (ارتقای هش لازم نیست چون بلافاصله هش تازه می‌گذاریم)
    from app.core.security import verify_password

    ok, _ = verify_password(member.password_hash or "", current_password, phone=member.phone)
    if not ok:
        raise AppError("INVALID_CREDENTIALS", "رمز فعلی نادرست است.", 401)

    if new_password is None or len(new_password) < _MIN_PASSWORD:
        raise AppError("WEAK_PASSWORD", "رمز جدید باید حداقل ۸ کاراکتر باشد.", 422)

    member.password_hash = hash_password(new_password)
    db.commit()

    # همهٔ نشست‌های دیگر باطل می‌شوند؛ نشست جاری می‌ماند
    sessions.revoke_others(db, member.id, current_raw_token)


# ── عضو پیش‌ثبت‌شده توسط مدیر ─────────────────────────────────
def check_pre_registered(
    db: Session, phone: str, *, ip: str = _UNKNOWN_IP
) -> PreRegisteredResult:
    """آیا این شماره توسط مدیری به‌عنوان عضو pending معرفی شده؟ (بدون احراز هویت).

    این اندپوینت یک «اوراکل» است: با شماره‌ای که نداری می‌توانی بپرسی آیا آن شماره
    در سامانه دعوت شده. پس سه مهار روی آن هست:

    ۱) نامِ عضو برنمی‌گردد — فقط نامِ خانواده (که لازمهٔ متنِ «به خانوادهٔ … دعوت
       شده‌اید» است).
    ۲) سقفِ per-IP (رفعِ #۱۵): سطلِ ناشناسِ هر مبدأ. پیش از این فقط سقفِ سراسری بود،
       و همان سقف خودش تبدیل به سلاحِ DoS می‌شد: مهاجم با ۶۰ درخواست در دقیقه
       اندپوینت را برای همهٔ کاربرانِ واقعی می‌بست.
    ۳) سقفِ سراسری به‌عنوان دفاعِ عمقی در برابرِ مهاجمِ توزیع‌شده.

    شمارهٔ پرسیده‌شده ذخیره نمی‌شود تا این جدول به فهرستِ شماره‌های آزموده‌شده بدل
    نشود؛ کلیدِ سطل هم هشِ نمک‌خوردهٔ IP است نه خودش.
    """
    ratelimit.hit(db, "pre_reg", ip, limit=settings.rl_pre_registered_per_ip)
    ratelimit.global_hit(db, "pre_reg", limit=_PRE_REG_MAX_PER_MINUTE)

    row = db.execute(
        select(Family.name)
        .join(Member, Member.family_id == Family.id)
        .where(Member.phone == phone, Member.status == "pending")
        .limit(1)
    ).scalar_one_or_none()

    if row is None:
        return PreRegisteredResult(pre_registered=False)
    return PreRegisteredResult(pre_registered=True, family_name=row)
