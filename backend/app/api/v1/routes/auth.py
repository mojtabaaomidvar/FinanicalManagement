"""روترهای احراز هویت — نگاشت اندپوینت‌ها به سرویس‌ها.

توکن نشست فقط از هدر Authorization خوانده می‌شود (وابستگی‌های deps)؛ هیچ اندپوینتی
توکن را از بدنه نمی‌پذیرد.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import (
    Principal,
    get_current_member,
    get_principal,
    require_owner,
)
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
    LoginRequest,
    MemberPublic,
    OkResult,
    OtpRequest,
    PreRegisteredRequest,
    PreRegisteredResult,
    PublicConfig,
    RegisterRequest,
    SessionPayload,
)
from app.services import auth as auth_service
from app.services import family as family_service
from app.services import otp as otp_service
from app.services import sessions

router = APIRouter(prefix="/auth", tags=["auth"])


# ── عمومی (بدون احراز هویت) ──────────────────────────────────
@router.get("/config", response_model=PublicConfig)
def get_config(db: Session = Depends(get_db)) -> PublicConfig:
    return auth_service.public_config(db)


@router.post("/otp/request", response_model=dict)
def request_otp(body: OtpRequest, db: Session = Depends(get_db)) -> dict:
    """حالت توسعه: کد برمی‌گردد. در تولید OTP_API_ONLY (ارسال از فاز ۸)."""
    code = otp_service.request_otp_dev(db, body.phone)
    return {"code": code}


@router.post("/check-password", response_model=OkResult)
def check_password(body: CheckPasswordRequest, db: Session = Depends(get_db)) -> OkResult:
    return OkResult(ok=auth_service.check_password(db, body.phone, body.password))


@router.post("/pre-registered", response_model=PreRegisteredResult)
def pre_registered(
    body: PreRegisteredRequest, db: Session = Depends(get_db)
) -> PreRegisteredResult:
    return auth_service.check_pre_registered(db, body.phone)


@router.post("/login", response_model=AuthResult)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> AuthResult:
    return auth_service.login(db, body.phone, body.password, body.code)


@router.post("/register", response_model=AuthResult)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> AuthResult:
    return auth_service.register(db, body)


@router.get("/invite/{token}", response_model=InviteInfo)
def get_invite(token: str, db: Session = Depends(get_db)) -> InviteInfo:
    return family_service.get_invite(db, token)


@router.post("/accept-invite", response_model=AuthResult)
def accept_invite(body: AcceptInviteRequest, db: Session = Depends(get_db)) -> AuthResult:
    return family_service.accept_invite(db, body)


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
    owner: Member = Depends(require_owner),
    db: Session = Depends(get_db),
) -> MemberPublic:
    return family_service.add_member_by_manager(db, owner, body.name, body.phone, body.relation)


@router.delete("/members/{member_id}", response_model=OkResult)
def remove_member(
    member_id: str,
    owner: Member = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OkResult:
    import uuid

    try:
        mid = uuid.UUID(member_id)
    except ValueError as exc:
        from app.core.errors import AppError

        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404) from exc
    family_service.remove_member(db, owner, mid)
    return OkResult(ok=True)


@router.post("/invite", response_model=InviteToken)
def create_invite(
    owner: Member = Depends(require_owner),
    db: Session = Depends(get_db),
) -> InviteToken:
    token = family_service.create_invite(db, owner.family_id, owner.id)
    return InviteToken(token=token)
