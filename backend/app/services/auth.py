"""هستهٔ احراز هویت: ورود، ثبت‌نام، تغییر رمز، پیش‌ثبت، پیکربندی عمومی.

اصل ثابت: توکن نشست فقط از هدر می‌آید (لایهٔ deps)؛ این سرویس هرگز توکن را از
بدنه نمی‌خواند. شناخت شماره‌ی صحیح به‌تنهایی نشست نمی‌دهد — رمز در سرور بررسی می‌شود.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import hash_password
from app.models.auth import LookupAttempt
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
from app.services import passwords, sessions
from app.services.clock import utcnow

_MIN_PASSWORD = 8
_PRE_REG_MAX_PER_MINUTE = 60  # سطل سراسری (نه per-phone) — ضدِ «شمارش شماره‌ها»


# ── پیکربندی عمومی ───────────────────────────────────────────
def public_config(db: Session) -> PublicConfig:
    return PublicConfig(otp_enabled=otp_service.is_otp_enabled(db))


# ── بررسی رمز (مرحلهٔ ۱ فرم ورود) ────────────────────────────
def check_password(db: Session, phone: str, password: str) -> bool:
    return passwords.check_password_gated(db, phone, password)


# ── ورود ─────────────────────────────────────────────────────
def login(db: Session, phone: str, password: str, code: str | None) -> AuthResult:
    if not passwords.check_password_gated(db, phone, password):
        raise AppError("INVALID_CREDENTIALS", "شماره یا رمز عبور نادرست است.", 401)

    otp_service.consume_otp(db, phone, code)

    member = db.execute(
        select(Member).where(Member.phone == phone).limit(1)
    ).scalar_one_or_none()
    if member is None:
        raise AppError("NO_MEMBER", "کاربری با این شماره یافت نشد.", 404)

    family = db.get(Family, member.family_id)
    token = sessions.create_session(db, member.id)
    return AuthResult(
        member=MemberPublic.of(member),
        family=FamilyOut.of(family),
        session_token=token,
    )


# ── ثبت‌نام ──────────────────────────────────────────────────
def _generate_family_code(db: Session) -> str:
    """کد ۶ رقمیِ یکتای خانواده (حلقه تا نبودِ تکراری)."""
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        exists = db.execute(
            select(Family.id).where(Family.code == code).limit(1)
        ).first()
        if exists is None:
            return code


def register(db: Session, req: RegisterRequest) -> AuthResult:
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
        # تکمیل ثبت‌نامِ عضوِ معرفی‌شده توسط مدیر
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

    # خانوادهٔ تازه + عضوِ اول (مدیر؛ نسبت همیشه «خودم»)
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
def check_pre_registered(db: Session, phone: str) -> PreRegisteredResult:
    """آیا این شماره توسط مدیری به‌عنوان عضو pending معرفی شده؟ (بدون احراز هویت).

    محدودیت‌ها: نام عضو برنمی‌گردد (فقط نام خانواده)؛ سقف سراسری ۶۰ جست‌وجو در دقیقه.
    شماره ذخیره نمی‌شود تا این جدول به فهرست شماره‌های آزموده‌شده تبدیل نشود.
    """
    db.execute(
        delete(LookupAttempt).where(LookupAttempt.created_at < utcnow() - timedelta(hours=1))
    )
    probes = db.execute(
        select(func.count())
        .select_from(LookupAttempt)
        .where(
            LookupAttempt.kind == "pre_reg",
            LookupAttempt.created_at > utcnow() - timedelta(minutes=1),
        )
    ).scalar_one()
    if int(probes) >= _PRE_REG_MAX_PER_MINUTE:
        raise AppError("TOO_MANY_ATTEMPTS", "تعداد درخواست‌ها زیاد است؛ کمی بعد.", 429)
    db.add(LookupAttempt(kind="pre_reg"))
    db.commit()

    row = db.execute(
        select(Family.name)
        .join(Member, Member.family_id == Family.id)
        .where(Member.phone == phone, Member.status == "pending")
        .limit(1)
    ).scalar_one_or_none()

    if row is None:
        return PreRegisteredResult(pre_registered=False)
    return PreRegisteredResult(pre_registered=True, family_name=row)
