"""Private owner-only goals and wishes, with authenticated encrypted content."""

from __future__ import annotations

import json
import logging
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.family import Member
from app.models.goal import Goal
from app.schemas.goals import GoalContent, GoalListOut, GoalOut, GoalUpdate, GoalWrite
from app.services.encrypted_payload import cipher_from_key, decrypt_payload, encrypt_payload
from app.services.inventory import clean_title

logger = logging.getLogger(__name__)
_PREFIX = b"KYGOAL1"
_MAX_GOALS = 200
_UNAVAILABLE = "اهداف و آرزوها اکنون در دسترس نیستند."


def require_active(actor: Member) -> None:
    if actor.status != "active" or actor.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)


def _audit(action: str, actor: Member, goal_id: object | None = None) -> None:
    logger.info("goals action=%s actor=%s goal=%s", action, actor.id, goal_id or "none")


def _cipher() -> AESGCM:
    try:
        return cipher_from_key(settings.document_encryption_key)
    except ValueError:
        raise AppError("GOALS_NOT_CONFIGURED", _UNAVAILABLE, 503) from None


def _aad(row: Goal) -> bytes:
    return f"khaneyar-goal-v1:{row.family_id}:{row.owner_id}:{row.id}:content".encode("ascii")


def _content(row: Goal) -> GoalContent:
    cipher = _cipher()
    try:
        data = decrypt_payload(cipher, row.encrypted_content, prefix=_PREFIX, aad=_aad(row))
        return GoalContent.model_validate(json.loads(data))
    except (InvalidTag, ValueError, UnicodeError, TypeError):
        raise AppError("GOAL_UNAVAILABLE", _UNAVAILABLE, 503) from None


def _seal(row: Goal, body: GoalWrite) -> None:
    content = GoalContent(
        title=clean_title(body.title, "عنوان هدف یا آرزو"),
        note=(body.note or "").strip() or None,
    )
    row.encrypted_content = encrypt_payload(
        _cipher(),
        json.dumps(content.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        prefix=_PREFIX,
        aad=_aad(row),
    )


def _out(row: Goal) -> GoalOut:
    content = _content(row)
    return GoalOut(
        id=str(row.id),
        owner_id=str(row.owner_id),
        kind=row.kind,
        title=content.title,
        note=content.note,
        target_date=row.target_date,
        status=row.status,
        reminder_enabled=row.reminder_enabled,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _find(db: Session, actor: Member, goal_id: uuid.UUID, *, lock: bool = False) -> Goal:
    require_active(actor)
    query = select(Goal).where(
        Goal.id == goal_id,
        Goal.family_id == actor.family_id,
        Goal.owner_id == actor.id,
    )
    if lock:
        query = query.with_for_update()
    row = db.scalar(query.execution_options(populate_existing=True))
    if row is None:
        _audit("denied", actor, goal_id)
        raise AppError("NOT_FOUND", "هدف یا آرزو یافت نشد.", 404)
    return row


def _revision(row: Goal, revision: int) -> None:
    if row.revision != revision:
        raise AppError("SYNC_CONFLICT", "این مورد تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409)


def _values(body: GoalWrite) -> dict:
    return body.model_dump(exclude={"title", "note", "base_revision"})


def list_goals(db: Session, actor: Member) -> GoalListOut:
    require_active(actor)
    _cipher()
    rows = db.scalars(
        select(Goal)
        .where(
            Goal.family_id == actor.family_id,
            Goal.owner_id == actor.id,
        )
        .order_by(Goal.created_at.desc(), Goal.id)
    )
    result = GoalListOut(goals=[_out(row) for row in rows], can_create=True)
    _audit("list", actor)
    return result


def get(db: Session, actor: Member, goal_id: uuid.UUID) -> GoalOut:
    row = _find(db, actor, goal_id)
    result = _out(row)
    _audit("get", actor, row.id)
    return result


def create(db: Session, actor: Member, body: GoalWrite) -> GoalOut:
    require_active(actor)
    row = Goal(id=uuid.uuid4(), family_id=actor.family_id, owner_id=actor.id, **_values(body))
    _seal(row, body)
    locked_actor = db.scalar(
        select(Member)
        .where(
            Member.id == actor.id,
            Member.family_id == actor.family_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_actor is None:
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)
    require_active(locked_actor)
    count = db.scalar(
        select(func.count())
        .select_from(Goal)
        .where(
            Goal.family_id == actor.family_id,
            Goal.owner_id == actor.id,
        )
    )
    if count >= _MAX_GOALS:
        raise AppError("LIMIT_REACHED", "تعداد اهداف و آرزوهای شما به سقف رسیده است.", 409)
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit("create", actor, row.id)
    return _out(row)


def update(db: Session, actor: Member, goal_id: uuid.UUID, body: GoalUpdate) -> GoalOut:
    row = _find(db, actor, goal_id, lock=True)
    _revision(row, body.base_revision)
    _content(row)
    _seal(row, body)
    for field, value in _values(body).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    _audit("update", actor, row.id)
    return _out(row)


def remove(db: Session, actor: Member, goal_id: uuid.UUID, revision: int) -> None:
    row = _find(db, actor, goal_id, lock=True)
    _revision(row, revision)
    db.delete(row)
    db.commit()
    _audit("delete", actor, goal_id)
