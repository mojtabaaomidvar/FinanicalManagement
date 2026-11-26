"""Atomic, short-lived operational limits, separate from identity-free AI analytics."""

import hashlib
import hmac
import logging
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timedelta
from functools import wraps
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, text

from app.core.config import settings
from app.core.errors import AppError
from app.db.session import SessionLocal
from app.models.ai_capacity import AiCapacityLease, AiDailyAllowance
from app.services.clock import utcnow

logger = logging.getLogger(__name__)
_family: ContextVar[str | None] = ContextVar("ai_allowance_family", default=None)


@contextmanager
def for_family(family_id):
    token = _family.set(str(family_id))
    try:
        yield
    finally:
        _family.reset(token)


def family_calls(function):
    @wraps(function)
    def controlled(db, actor, *args, **kwargs):
        with for_family(actor.family_id):
            return function(db, actor, *args, **kwargs)
    return controlled


def connection_mode() -> str:
    mode = settings.ai_connection_mode
    if mode == "disabled":
        raise AppError(
            "ASSISTANT_DISABLED", "دستیار موقتاً غیرفعال است؛ ثبت دستی در دسترس است.", 503,
        )
    if mode == "auto":
        return "gateway" if settings.ai_sms_gateway_url.strip() else "direct"
    return mode


def reserve_call():
    limits = (settings.ai_requests_per_day, settings.ai_family_requests_per_day,
              settings.ai_max_concurrent)
    if not any(limits):
        return None
    now = utcnow()
    day = now.astimezone(ZoneInfo("Asia/Tehran")).date()
    scopes = []
    if limits[0]:
        scopes.append(("global", limits[0]))
    if limits[1]:
        family, secret = _family.get(), settings.rate_limit_salt or settings.file_signing_secret
        if not family or not secret:
            raise AppError(
                "AI_LIMITS_UNAVAILABLE", "بررسی سقف مصرف دستیار ممکن نشد؛ دوباره تلاش کنید.", 503,
            )
        # A daily operational pseudonym, never a raw identifier or analytics dimension.
        scope = hmac.new(secret.encode(), f"ai-allowance/{day}/{family}".encode(),
                         hashlib.sha256).hexdigest()
        scopes.append((scope, limits[1]))
    lease = uuid.uuid4() if limits[2] else None
    try:
        with SessionLocal() as db:
            db.execute(text("SET LOCAL lock_timeout='2s'"))
            db.execute(text("SELECT pg_advisory_xact_lock(1801544041, 1)"))
            db.execute(delete(AiDailyAllowance).where(
                AiDailyAllowance.day < day - timedelta(days=1),
            ))
            db.execute(delete(AiCapacityLease).where(AiCapacityLease.expires_at <= now))
            if lease and db.scalar(select(func.count()).select_from(AiCapacityLease)) >= limits[2]:
                db.commit()
                raise AppError(
                    "AI_CAPACITY_REACHED",
                    "دستیار مشغول پاسخ‌گویی است؛ کمی بعد دوباره تلاش کنید.", 429,
                )
            rows = []
            for scope, maximum in scopes:
                row = db.get(AiDailyAllowance, (day, scope))
                if row is not None and row.requests >= maximum:
                    db.commit()
                    raise AppError(
                        "AI_DAILY_LIMIT",
                        "سقف روزانهٔ استفاده از دستیار پر شده است؛ فردا دوباره تلاش کنید.", 429,
                    )
                rows.append((scope, row))
            for scope, row in rows:
                if row is None:
                    db.add(AiDailyAllowance(day=day, scope=scope, requests=1))
                else:
                    row.requests += 1
            if lease:
                db.add(AiCapacityLease(
                    id=lease,
                    expires_at=now + timedelta(seconds=settings.ai_sms_timeout_seconds + 30),
                ))
            db.commit()
        return lease
    except AppError:
        raise
    except Exception:
        logger.warning("AI capacity reservation unavailable")
        raise AppError(
            "AI_LIMITS_UNAVAILABLE", "بررسی سقف مصرف دستیار ممکن نشد؛ دوباره تلاش کنید.", 503,
        ) from None


def release_call(lease) -> None:
    if lease is None:
        return
    try:
        with SessionLocal() as db:
            db.execute(delete(AiCapacityLease).where(AiCapacityLease.id == lease))
            db.commit()
    except Exception:
        # The expiring lease recovers after a lost connection or process termination.
        logger.warning("AI capacity release unavailable")
