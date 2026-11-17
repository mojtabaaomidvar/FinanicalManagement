"""Read/write only the authenticated member's personal Home arrangement."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.family import Member
from app.schemas.home import HomePreferencesOut, HomePreferencesUpdate


def read_preferences(db: Session, actor: Member) -> HomePreferencesOut:
    row = db.execute(
        select(Member.home_preferences_revision, Member.home_preferences).where(
            Member.id == actor.id, Member.family_id == actor.family_id
        )
    ).one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    return HomePreferencesOut(revision=row[0], preferences=row[1])


def update_preferences(
    db: Session, actor: Member, body: HomePreferencesUpdate
) -> HomePreferencesOut:
    # Refresh under a row lock: two devices cannot both accept the same base revision.
    member = db.scalar(
        select(Member)
        .where(Member.id == actor.id, Member.family_id == actor.family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if member is None:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    if member.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "عضویت شما در خانواده فعال نیست.", 403)
    if member.home_preferences_revision != body.revision:
        raise AppError(
            "SYNC_CONFLICT", "چیدمان شما تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.", 409
        )
    member.home_preferences = body.preferences.model_dump()
    member.home_preferences_revision += 1
    result = HomePreferencesOut(
        revision=member.home_preferences_revision, preferences=member.home_preferences
    )
    db.commit()
    return result
