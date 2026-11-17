"""Canonical shared activities with current participants and revision-based writes."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import AppError
from app.models.activity_participant import ActivityParticipant
from app.models.event import FamilyEvent
from app.models.family import Family, Member
from app.schemas.activities import ActivityListOut, ActivityOut, ActivityUpdate, ActivityWrite
from app.services.common import is_admin
from app.services.events import _event_sort_key
from app.services.inventory import clean_opt_text, clean_title
from app.services.member_age import today_tehran

logger = logging.getLogger(__name__)
_MAX_ACTIVITIES = 200


def require_active(actor: Member) -> None:
    if actor.status != "active" or actor.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)


def _allowed(actor: Member, row: FamilyEvent) -> bool:
    return (
        actor.status == "active"
        and actor.membership_state == "active"
        and (is_admin(actor) or row.member_id == actor.id)
    )


def _audit(action: str, actor: Member, activity_id: object | None = None) -> None:
    logger.info(
        "activities action=%s actor=%s activity=%s", action, actor.id, activity_id or "none"
    )


def _authorize(actor: Member, row: FamilyEvent, revision: int | None = None) -> None:
    require_active(actor)
    if not _allowed(actor, row):
        raise AppError("ACTIVITY_FORBIDDEN", "اجازهٔ تغییر یا حذف این برنامه را ندارید.", 403)
    if revision is not None and row.revision != revision:
        raise AppError("SYNC_CONFLICT", "این برنامه تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409)


def _get(db: Session, actor: Member, activity_id: uuid.UUID, *, lock: bool = False) -> FamilyEvent:
    require_active(actor)
    query = (
        select(FamilyEvent)
        .where(
            FamilyEvent.id == activity_id,
            FamilyEvent.family_id == actor.family_id,
            FamilyEvent.kind == "activity",
        )
        .execution_options(populate_existing=True)
    )
    if lock:
        current = db.scalar(query)
        if current is not None:
            _authorize(actor, current)
        query = query.with_for_update()
    row = db.scalar(query)
    if row is None:
        raise AppError("NOT_FOUND", "برنامه یافت نشد.", 404)
    return row


def _participants(db: Session, actor: Member, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    result: dict[uuid.UUID, list[str]] = {}
    if not ids:
        return result
    rows = db.execute(
        select(ActivityParticipant.activity_id, ActivityParticipant.member_id)
        .join(
            Member,
            (Member.id == ActivityParticipant.member_id)
            & (Member.family_id == ActivityParticipant.family_id),
        )
        .where(
            ActivityParticipant.family_id == actor.family_id,
            ActivityParticipant.activity_id.in_(ids),
            Member.membership_state == "active",
        )
        .order_by(ActivityParticipant.member_id)
    )
    for activity_id, member_id in rows:
        result.setdefault(activity_id, []).append(str(member_id))
    return result


def _out(row: FamilyEvent, actor: Member, participants: list[str]) -> ActivityOut:
    return ActivityOut(
        id=str(row.id),
        title=row.title,
        note=row.note,
        date=row.date,
        location=row.location,
        status=row.activity_status,
        participant_ids=participants,
        reminder_enabled=row.reminder_enabled,
        created_by=str(row.member_id) if row.member_id else None,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=_allowed(actor, row),
        can_delete=_allowed(actor, row),
    )


def _one_out(db: Session, actor: Member, row: FamilyEvent) -> ActivityOut:
    return _out(row, actor, _participants(db, actor, [row.id]).get(row.id, []))


def _values(db: Session, actor: Member, body: ActivityWrite) -> dict:
    if body.participant_ids:
        valid = set(
            db.scalars(
                select(Member.id).where(
                    Member.id.in_(body.participant_ids),
                    Member.family_id == actor.family_id,
                    Member.membership_state == "active",
                )
            )
        )
        if valid != set(body.participant_ids):
            raise AppError(
                "INVALID_PARTICIPANTS", "شرکت‌کنندگان باید اعضای فعال همین خانواده باشند.", 422
            )
    return {
        "title": clean_title(body.title, "عنوان برنامه"),
        "note": (body.note or "").strip() or None,
        "date": body.date,
        "location": clean_opt_text(body.location, 180, "مکان"),
        "activity_status": body.status,
        "reminder_enabled": body.reminder_enabled,
    }


def _replace_participants(
    db: Session, actor: Member, row: FamilyEvent, ids: list[uuid.UUID]
) -> None:
    # Session autoflush is disabled; participant guards must see the saved parent.
    db.flush([row])
    db.execute(
        delete(ActivityParticipant).where(
            ActivityParticipant.activity_id == row.id,
            ActivityParticipant.family_id == actor.family_id,
        )
    )
    db.add_all(
        [
            ActivityParticipant(activity_id=row.id, member_id=member_id, family_id=actor.family_id)
            for member_id in ids
        ]
    )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) in {
            "fk_activity_participant_member_family",
            "fk_activity_participant_event_family",
            "activity_participant_active_member",
            "activity_participant_target_kind",
        }:
            raise AppError(
                "SYNC_CONFLICT", "اعضای برنامه تغییر کرده‌اند؛ دوباره بررسی کنید.", 409
            ) from None
        raise


def list_activities(db: Session, actor: Member) -> ActivityListOut:
    require_active(actor)
    rows = list(
        db.scalars(
            select(FamilyEvent).where(
                FamilyEvent.family_id == actor.family_id,
                FamilyEvent.kind == "activity",
            )
        )
    )
    rows.sort(key=lambda row: _event_sort_key(row, today_tehran()))
    participants = _participants(db, actor, [row.id for row in rows])
    return ActivityListOut(
        activities=[_out(row, actor, participants.get(row.id, [])) for row in rows], can_create=True
    )


def get(db: Session, actor: Member, activity_id: uuid.UUID) -> ActivityOut:
    return _one_out(db, actor, _get(db, actor, activity_id))


def create(db: Session, actor: Member, body: ActivityWrite) -> ActivityOut:
    require_active(actor)
    values = _values(db, actor, body)
    db.scalar(select(Family).where(Family.id == actor.family_id).with_for_update())
    count = db.scalar(
        select(func.count())
        .select_from(FamilyEvent)
        .where(
            FamilyEvent.family_id == actor.family_id,
            FamilyEvent.kind == "activity",
        )
    )
    if count >= _MAX_ACTIVITIES:
        raise AppError("LIMIT_REACHED", "تعداد برنامه‌های خانواده به سقف رسیده است.", 409)
    row = FamilyEvent(
        id=uuid.uuid4(),
        family_id=actor.family_id,
        member_id=actor.id,
        kind="activity",
        for_member_id=None,
        **values,
    )
    db.add(row)
    _replace_participants(db, actor, row, body.participant_ids)
    _commit(db)
    db.refresh(row)
    _audit("create", actor, row.id)
    return _one_out(db, actor, row)


def update(db: Session, actor: Member, activity_id: uuid.UUID, body: ActivityUpdate) -> ActivityOut:
    row = _get(db, actor, activity_id, lock=True)
    _authorize(actor, row, body.base_revision)
    values = _values(db, actor, body)
    for field, value in values.items():
        setattr(row, field, value)
    # Even a no-op editor save has a new revision, matching other online modules.
    flag_modified(row, "title")
    _replace_participants(db, actor, row, body.participant_ids)
    _commit(db)
    db.refresh(row)
    _audit("update", actor, row.id)
    return _one_out(db, actor, row)


def remove(db: Session, actor: Member, activity_id: uuid.UUID, revision: int) -> None:
    row = _get(db, actor, activity_id, lock=True)
    _authorize(actor, row, revision)
    db.delete(row)
    _commit(db)
    _audit("delete", actor, activity_id)
