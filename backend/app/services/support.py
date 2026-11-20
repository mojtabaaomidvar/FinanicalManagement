"""Read-only operator projections and independent authentication."""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Request
from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.netaddr import client_ip
from app.core.security import hash_token, new_session_token, verify_password
from app.db.session import SessionLocal
from app.models.family import Member
from app.models.support import SupportErrorCounter, SupportSession
from app.schemas.support import SupportOverview, SupportTechnical, SupportUser, SupportUsers
from app.services import ratelimit

COOKIE_NAME = "khaneyar_support"
COOKIE_PATH = "/api/v1/support"
SESSION_SECONDS = 1800
ERROR_ROUTES = {
    "/api/v1/auth/login": "login",
    "/api/v1/auth/register": "registration",
    "/api/v1/auth/join": "registration",
    "/api/v1/auth/accept-invite": "registration",
}
logger = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


def enabled() -> bool:
    return bool(settings.support_username.strip()
                and settings.support_password_hash.startswith("$argon2id$"))


def require_enabled() -> None:
    if not enabled():
        raise AppError("SUPPORT_DISABLED", "ورود پشتیبانی هنوز فعال نشده است.", 503)


def credential_tag() -> str:
    return hashlib.sha256((settings.support_username + "\0" + settings.support_password_hash).encode()).hexdigest()


def require_origin(request: Request, *, allow_absent: bool = False) -> None:
    origin = request.headers.get("origin")
    if origin is None and allow_absent:
        return
    if origin not in settings.support_origins_list:
        raise AppError("SUPPORT_ORIGIN", "این درخواست پشتیبانی مجاز نیست.", 403)


def login(db: Session, request: Request, username: str, password: str) -> str:
    require_enabled()
    require_origin(request)
    # Per-origin and global caps share the existing persistent anonymous limiter.
    ratelimit.hit(db, "support_login", client_ip(request), limit=max(1, settings.rl_support_login_per_ip))
    ratelimit.hit(db, "support_login_global", "support-operator", limit=30)
    valid_password, _ = verify_password(settings.support_password_hash, password)
    valid_username = hmac.compare_digest(username.encode(), settings.support_username.encode())
    if not (valid_password and valid_username):
        raise AppError("SUPPORT_LOGIN_FAILED", "نام کاربری یا رمز پشتیبانی درست نیست.", 401)
    raw, token_hash = new_session_token()
    timestamp = now()
    db.execute(delete(SupportSession).where(SupportSession.expires_at <= timestamp))
    db.add(SupportSession(token_hash=token_hash, credential_tag=credential_tag(),
                          expires_at=timestamp + timedelta(seconds=SESSION_SECONDS)))
    db.commit()
    return raw


def authenticated(db: Session, request: Request) -> bool:
    if not enabled():
        return False
    token = request.cookies.get(COOKIE_NAME, "")
    if len(token) != settings.session_token_bytes * 2:
        return False
    row = db.execute(select(SupportSession.expires_at, SupportSession.credential_tag)
                     .where(SupportSession.token_hash == hash_token(token))).one_or_none()
    return bool(row and row.expires_at > now()
                and hmac.compare_digest(row.credential_tag, credential_tag()))


def require_session(db: Session, request: Request) -> None:
    require_enabled()
    require_origin(request, allow_absent=True)
    if not authenticated(db, request):
        raise AppError("SUPPORT_UNAUTHORIZED", "برای مشاهدهٔ پنل، وارد حساب پشتیبانی شوید.", 401)


def logout(db: Session, request: Request) -> None:
    require_origin(request)
    token = request.cookies.get(COOKIE_NAME, "")
    if token:
        db.execute(delete(SupportSession).where(SupportSession.token_hash == hash_token(token)))
        db.commit()


def registration_expression():
    # Presence is evaluated by SQL, never returned as a hash or credential.
    return case((Member.status == "pending", "introduced"),
                (Member.password_hash.is_not(None), "registered"), else_="managed")


def list_users(db: Session, *, code: str, membership: str, registration: str,
               offset: int, limit: int) -> SupportUsers:
    state = registration_expression()
    query = select(Member.support_code, Member.created_at,
                   state.label("registration_state"), Member.membership_state,
                   Member.support_registered_at.label("registered_at"), Member.support_last_login_at.label("last_login_at"))
    conditions = []
    if code.strip():
        try:
            parsed = UUID(code.strip())
        except ValueError:
            return SupportUsers(items=[], total=0, offset=offset, limit=limit)
        conditions.append(Member.support_code == parsed)
    if membership != "all":
        conditions.append(Member.membership_state == membership)
    if registration != "all":
        conditions.append(state == registration)
    total = db.execute(select(func.count()).select_from(Member).where(*conditions)).scalar_one()
    rows = db.execute(query.where(*conditions).order_by(Member.created_at.desc(), Member.support_code)
                      .offset(offset).limit(limit)).all()
    return SupportUsers(items=[SupportUser(**row._mapping, **onboarding_state(row.registration_state, row.membership_state)) for row in rows],
                        total=total, offset=offset, limit=limit)


def onboarding_state(registration: str, membership: str) -> dict:
    if registration == "introduced":
        return {"stage": "registration_required", "attention_reason": "registration_incomplete"}
    if registration == "managed":
        return {"stage": "managed_profile", "attention_reason": "managed_profile"}
    if membership == "pending":
        return {"stage": "approval_pending", "attention_reason": "waiting_approval"}
    if membership == "active":
        return {"stage": "ready", "attention_reason": None}
    return {"stage": "inactive", "attention_reason": membership}


def overview(db: Session, days: int) -> SupportOverview:
    timestamp = now()
    state = registration_expression()
    counts = dict(db.execute(select(state, func.count()).group_by(state)).all())
    registered = state == "registered"
    awaiting = db.execute(select(func.count()).select_from(Member).where(
        registered, Member.membership_state == "pending")).scalar_one()
    active = db.execute(select(func.count()).select_from(Member).where(
        registered, Member.membership_state == "active")).scalar_one()
    # Calendar buckets use Tehran days, including the local start of the selected range.
    from zoneinfo import ZoneInfo
    local = timestamp.astimezone(ZoneInfo("Asia/Tehran"))
    first_day = local.date() - timedelta(days=days-1)
    start = datetime.combine(first_day, datetime.min.time(), ZoneInfo("Asia/Tehran"))
    day = func.date(func.timezone("Asia/Tehran", Member.created_at))
    daily_rows = dict(db.execute(select(day, func.count()).where(
        registered, Member.created_at >= start).group_by(day)).all())
    daily = [{"day": (first_day+timedelta(days=i)).isoformat(),
              "registrations": daily_rows.get(first_day+timedelta(days=i), 0)} for i in range(days)]
    return SupportOverview(registered=counts.get("registered",0), introduced=counts.get("introduced",0),
        managed=counts.get("managed",0), awaiting_approval=awaiting, active=active,
        new_registrations=sum(item["registrations"] for item in daily), daily=daily, checked_at=timestamp)


def technical(db: Session) -> SupportTechnical:
    timestamp = now()
    # The current partial hour plus 23 prior hourly buckets, labelled as such.
    start = timestamp.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
    rows = db.execute(select(SupportErrorCounter.kind, SupportErrorCounter.http_family,
                             func.sum(SupportErrorCounter.count)).where(
        SupportErrorCounter.hour >= start).group_by(SupportErrorCounter.kind, SupportErrorCounter.http_family)).all()
    return SupportTechnical(api="available", database="available",
        sms="configured" if settings.sms_provider and settings.sms_api_key else "disabled",
        login_errors=sum(count for kind, _, count in rows if kind=="login"),
        registration_errors=sum(count for kind, _, count in rows if kind=="registration"),
        server_errors=sum(count for _, category, count in rows if category=="server"),
        measured_hours=24, checked_at=timestamp)


def record_error(path: str, status: int) -> None:
    kind = ERROR_ROUTES.get(path)
    if not kind or status < 400:
        return
    hour = now().replace(minute=0, second=0, microsecond=0)
    category = "server" if status >= 500 else "client"
    try:
        with SessionLocal() as db:
            statement = insert(SupportErrorCounter).values(hour=hour, kind=kind,
                                                          http_family=category, count=1)
            db.execute(statement.on_conflict_do_update(
                index_elements=[SupportErrorCounter.hour, SupportErrorCounter.kind, SupportErrorCounter.http_family],
                set_={"count": SupportErrorCounter.count+1}))
            db.commit()
    except Exception:
        # Telemetry must never break login or expose the original request/exception.
        logger.warning("Support counter unavailable")
