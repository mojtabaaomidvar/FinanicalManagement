"""چرخهٔ حیات نشست — ساخت، اعتبارسنجی/تازه‌سازی، و ابطال.

معناشناسی «جدید» (متفاوت با schema.sql، طبق تصمیم قفل‌شده):
- token در دیتابیس = هش SHA-256 توکن خام (رفع D-3). توکن خام فقط یک‌بار به کلاینت
  داده می‌شود و هرگز ذخیره نمی‌شود.
- expires_at = سقف مطلق (now + ۹۰ روز)؛ با استفاده تمدید نمی‌شود.
- last_seen_at = پنجرهٔ لغزان (۷ روز عدم فعالیت = خروج)؛ با هر استفاده به now می‌رود.
- نشست معتبر است اگر و فقط اگر: now < expires_at  و  now < last_seen_at + ۷ روز.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import hash_token, new_session_token
from app.models.auth import Session as SessionModel
from app.services.clock import utcnow

_SLIDING = timedelta(days=settings.session_sliding_days)
_ABSOLUTE = timedelta(days=settings.session_absolute_days)


def create_session(db: Session, member_id: uuid.UUID) -> str:
    """نشست تازه می‌سازد و «توکن خام» را برمی‌گرداند (فقط همین‌جا در دسترس است)."""
    raw, token_hash = new_session_token()
    now = utcnow()
    db.add(
        SessionModel(
            token=token_hash,
            member_id=member_id,
            expires_at=now + _ABSOLUTE,
            last_seen_at=now,
        )
    )
    db.commit()
    return raw


def _session_dead(now, row: SessionModel) -> bool:
    return row.expires_at <= now or row.last_seen_at <= now - _SLIDING


def resolve_member_id(db: Session, raw_token: str) -> uuid.UUID:
    """توکن خام → شناسهٔ عضو؛ نشست را تازه می‌کند. در صورت نامعتبری SESSION_EXPIRED."""
    now = utcnow()
    # خانه‌تکانی: نشست‌های مرده (سقف مطلق گذشته یا لغزش تمام‌شده)
    db.execute(
        delete(SessionModel).where(
            or_(
                SessionModel.expires_at <= now,
                SessionModel.last_seen_at <= now - _SLIDING,
            )
        )
    )

    token_hash = hash_token(raw_token)
    row = db.execute(
        select(SessionModel).where(SessionModel.token == token_hash).limit(1)
    ).scalar_one_or_none()

    if row is None or _session_dead(now, row):
        db.commit()  # پایدارکردن خانه‌تکانی
        raise AppError("SESSION_EXPIRED", "نشست نامعتبر یا منقضی است.", 401)

    row.last_seen_at = now  # لغزش
    db.commit()
    return row.member_id


def logout(db: Session, raw_token: str) -> None:
    """ابطال همین نشست (بر پایهٔ هشِ توکن)."""
    db.execute(delete(SessionModel).where(SessionModel.token == hash_token(raw_token)))
    db.commit()


def logout_all(db: Session, member_id: uuid.UUID) -> None:
    """ابطال همهٔ نشست‌های این عضو (خروج از همهٔ دستگاه‌ها)."""
    db.execute(delete(SessionModel).where(SessionModel.member_id == member_id))
    db.commit()


def revoke_others(db: Session, member_id: uuid.UUID, keep_raw_token: str) -> None:
    """ابطال همهٔ نشست‌های این عضو جز نشست جاری (پس از تغییر رمز)."""
    keep = hash_token(keep_raw_token)
    db.execute(
        delete(SessionModel).where(
            SessionModel.member_id == member_id, SessionModel.token != keep
        )
    )
    db.commit()
