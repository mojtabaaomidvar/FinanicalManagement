"""روترهای احراز هویت — نگاشت اندپوینت‌ها به سرویس‌ها.

توکن نشست فقط از هدر Authorization خوانده می‌شود (وابستگی‌های deps)؛ هیچ اندپوینتی
توکن را از بدنه نمی‌پذیرد.

مسیرهای عمومی (بی‌احراز) شیءِ `Request` را می‌گیرند تا فقط `client_ip` را به سرویس
بدهند — کلیدِ سقفِ نرخِ per-IP (§5.11). خودِ نشانی نه لاگ می‌شود و نه ذخیره؛
سرویسِ ratelimit فقط هشِ نمک‌خورده‌اش را نگه می‌دارد.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import (
    Principal,
    get_current_member,
    get_principal,
    require_admin,
    require_admin_tenant,
)
from app.core.errors import AppError
from app.core.netaddr import client_ip
from app.db.session import get_db
from app.models.family import Member
from app.schemas.auth import (
    AcceptInviteRequest,
    AddMemberRequest,
    AuthResult,
    ChangePasswordRequest,
    CheckPasswordRequest,
    InviteInfo,
    InviteToken,
    JoinByCodeRequest,
    JoinPendingResult,
    JoinRequestOut,
    LoginRequest,
    MemberPublic,
    OkResult,
    OtpRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PreRegisteredRequest,
    PreRegisteredResult,
    PublicConfig,
    RegisterRequest,
    SessionPayload,
)
from app.services import auth as auth_service
from app.services import family as family_service
from app.services import otp as otp_service
from app.services import password_reset as reset_service
from app.services import sessions

router = APIRouter(prefix="/auth", tags=["auth"])


def _uuid_or_404(raw: str, msg: str) -> uuid.UUID:
    """شناسهٔ مسیر → UUID؛ قالبِ نامعتبر مثلِ «یافت نشد» رفتار می‌کند (نه ۵۰۰)."""
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise AppError("NOT_FOUND", msg, 404) from exc


# ── عمومی (بدون احراز هویت) ──────────────────────────────────
@router.get("/config", response_model=PublicConfig)
def get_config(db: Session = Depends(get_db)) -> PublicConfig:
    return auth_service.public_config(db)


@router.post("/otp/request", response_model=dict)
def request_otp(
    request: Request, body: OtpRequest, db: Session = Depends(get_db)
) -> dict:
    """درخواستِ کدِ ورود.

    `code` فقط در حالتِ توسعه پر است؛ با درگاهِ پیامکِ پیکربندی‌شده کد ارسال
    می‌شود و `null` برمی‌گردد. بی‌هیچ‌یک از این دو → OTP_API_ONLY.
    """
    code = otp_service.request_otp(db, body.phone, ip=client_ip(request))
    return {"code": code}


@router.post("/password-reset/request", response_model=OkResult)
def password_reset_request(
    request: Request,
    body: PasswordResetRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> OkResult:
    """گامِ ۱ فراموشیِ رمز (§9.5) — **همیشه** `{"ok": true}`.

    پاسخ برای شمارهٔ ثبت‌شده و ثبت‌نشده یکسان است (ضدِ شمارشِ حساب)، پس متنِ
    کلاینت هم باید شرطی و صادق باشد: «اگر این شماره ثبت شده باشد، کد برایش
    پیامک شد». ارسالِ پیامک در `BackgroundTasks` می‌رود تا زمانِ پاسخ هم نشتی
    نداشته باشد.
    """
    reset_service.request_reset(
        db, body.phone, background=background, ip=client_ip(request)
    )
    return OkResult(ok=True)


@router.post("/password-reset/confirm", response_model=OkResult)
def password_reset_confirm(
    request: Request, body: PasswordResetConfirmRequest, db: Session = Depends(get_db)
) -> OkResult:
    """گامِ ۲ فراموشیِ رمز — کد + رمزِ تازه. همهٔ نشست‌ها باطل می‌شوند.

    عمداً هیچ نشستی صادر نمی‌کند: کاربر با رمزِ تازه از مسیرِ عادیِ ورود می‌آید
    و همان‌جا گیتِ وضعیتِ عضویت (`_ensure_can_login`) اعمال می‌شود.
    """
    reset_service.confirm_reset(
        db, body.phone, body.code, body.new_password, ip=client_ip(request)
    )
    return OkResult(ok=True)


@router.post("/check-password", response_model=OkResult)
def check_password(
    request: Request, body: CheckPasswordRequest, db: Session = Depends(get_db)
) -> OkResult:
    return OkResult(
        ok=auth_service.check_password(
            db, body.phone, body.password, ip=client_ip(request)
        )
    )


@router.post("/pre-registered", response_model=PreRegisteredResult)
def pre_registered(
    request: Request, body: PreRegisteredRequest, db: Session = Depends(get_db)
) -> PreRegisteredResult:
    return auth_service.check_pre_registered(db, body.phone, ip=client_ip(request))


@router.post("/login", response_model=AuthResult)
def login(
    request: Request, body: LoginRequest, db: Session = Depends(get_db)
) -> AuthResult:
    return auth_service.login(
        db, body.phone, body.password, body.code, ip=client_ip(request)
    )


@router.post("/register", response_model=AuthResult)
def register(
    request: Request, body: RegisterRequest, db: Session = Depends(get_db)
) -> AuthResult:
    return auth_service.register(db, body, ip=client_ip(request))


@router.get("/invite/{token}", response_model=InviteInfo)
def get_invite(
    request: Request, token: str, db: Session = Depends(get_db)
) -> InviteInfo:
    return family_service.get_invite(db, token, ip=client_ip(request))


@router.post("/accept-invite", response_model=JoinPendingResult)
def accept_invite(
    request: Request, body: AcceptInviteRequest, db: Session = Depends(get_db)
) -> JoinPendingResult:
    """پذیرشِ لینکِ دعوت: درخواستِ عضویت ثبت می‌شود و منتظرِ تأییدِ مدیر می‌ماند.

    برخلافِ نسخهٔ پیشین، اینجا هیچ نشستی صادر نمی‌شود (§2.6 — رفعِ #۲)؛ کاربر پس از
    تأییدِ مدیر می‌تواند وارد شود.
    """
    return family_service.accept_invite(db, body, ip=client_ip(request))


@router.post("/join", response_model=JoinPendingResult)
def join_by_code(
    request: Request, body: JoinByCodeRequest, db: Session = Depends(get_db)
) -> JoinPendingResult:
    """پیوستن با «کدِ ۶ رقمیِ خانواده» — جریانِ درخواست/تأیید، بدونِ نشست."""
    return family_service.join_by_code(db, body, ip=client_ip(request))


# ── نیازمند نشست ─────────────────────────────────────────────
@router.get("/session", response_model=SessionPayload)
def validate_session(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> SessionPayload:
    return family_service.validate_session_payload(db, member)


@router.post("/logout", response_model=OkResult)
def logout(
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> OkResult:
    sessions.logout(db, principal.raw_token)
    return OkResult(ok=True)


@router.post("/logout-all", response_model=OkResult)
def logout_all(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> OkResult:
    sessions.logout_all(db, member.id)
    return OkResult(ok=True)


@router.post("/change-password", response_model=OkResult)
def change_password(
    body: ChangePasswordRequest,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> OkResult:
    auth_service.change_password(
        db, principal.member, body.current_password, body.new_password, principal.raw_token
    )
    return OkResult(ok=True)


# ── خانواده و اعضا ───────────────────────────────────────────
@router.get("/family", response_model=dict)
def get_family(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    from app.schemas.auth import FamilyOut

    family = family_service.family_of(db, member.family_id)
    return FamilyOut.of(family).model_dump(mode="json")


@router.get("/members", response_model=list[MemberPublic])
def get_members(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> list[MemberPublic]:
    return [MemberPublic.of(m) for m in family_service.members_of(db, member.family_id)]


@router.post("/members", response_model=MemberPublic)
def add_member(
    body: AddMemberRequest,
    owner: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> MemberPublic:
    return family_service.add_member_by_manager(db, owner, body.name, body.phone, body.relation)


@router.delete("/members/{member_id}", response_model=OkResult)
def remove_member(
    member_id: str,
    owner: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    family_service.remove_member(db, owner, _uuid_or_404(member_id, "عضو یافت نشد."))
    return OkResult(ok=True)


@router.post("/members/{member_id}/promote", response_model=MemberPublic)
def promote_member(
    member_id: str,
    owner: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> MemberPublic:
    """ارتقای عضوِ فعال به مدیرِ دوم (§2.3 — حداکثر دو مدیر)."""
    return family_service.promote_member(db, owner, _uuid_or_404(member_id, "عضو یافت نشد."))


@router.post("/members/{member_id}/demote", response_model=MemberPublic)
def demote_member(
    member_id: str,
    owner: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> MemberPublic:
    """تنزلِ مدیرِ دوم به عضوِ عادی (سازندهٔ خانواده قابل تنزل نیست)."""
    return family_service.demote_member(db, owner, _uuid_or_404(member_id, "عضو یافت نشد."))


@router.post("/invite", response_model=InviteToken)
def create_invite(
    owner: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> InviteToken:
    token = family_service.create_invite(db, owner.family_id, owner.id)
    return InviteToken(token=token)


# ── درخواست‌های پیوستن (فقط مدیر؛ زیرِ RLS → require_admin_tenant) ──
@router.get("/join-requests", response_model=list[JoinRequestOut])
def list_join_requests(
    owner: Member = Depends(require_admin_tenant),
    db: Session = Depends(get_db),
) -> list[JoinRequestOut]:
    """فهرستِ درخواست‌های پیوستنِ در انتظارِ خانواده."""
    return family_service.list_join_requests(db, owner)


@router.post("/join-requests/{request_id}/approve", response_model=MemberPublic)
def approve_join_request(
    request_id: str,
    owner: Member = Depends(require_admin_tenant),
    db: Session = Depends(get_db),
) -> MemberPublic:
    """تأیید: عضویتِ متقاضی فعال می‌شود و از این پس می‌تواند وارد شود."""
    return family_service.approve_join_request(
        db, owner, _uuid_or_404(request_id, "درخواست یافت نشد.")
    )


@router.post("/join-requests/{request_id}/reject", response_model=OkResult)
def reject_join_request(
    request_id: str,
    owner: Member = Depends(require_admin_tenant),
    db: Session = Depends(get_db),
) -> OkResult:
    """رد: عضویتِ متقاضی rejected می‌شود (ورود ممنوع)."""
    family_service.reject_join_request(db, owner, _uuid_or_404(request_id, "درخواست یافت نشد."))
    return OkResult(ok=True)
