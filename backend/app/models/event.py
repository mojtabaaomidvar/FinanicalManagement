"""رویدادهای خانوادگی (تولد، مناسبت‌ها، یادآوری‌ها)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FamilyEvent(Base):
    __tablename__ = "family_events"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_family_events_id_family"),
        ForeignKeyConstraint(
            ["member_id", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_event_creator_family",
        ),
        ForeignKeyConstraint(
            ["for_member_id", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_event_for_member_family",
        ),
        CheckConstraint("kind IN ('event','activity')", name="event_kind"),
        CheckConstraint("revision >= 1", name="event_revision_positive"),
        CheckConstraint(
            "(kind='event' AND activity_status IS NULL AND location IS NULL "
            "AND reminder_enabled) OR (kind='activity' "
            "AND activity_status IS NOT NULL AND activity_status IN ('planned','done','cancelled') "
            "AND for_member_id IS NULL AND char_length(title) BETWEEN 1 AND 120 "
            "AND (note IS NULL OR char_length(note) <= 2000) "
            "AND (location IS NULL OR char_length(location) <= 180))",
            name="event_activity_shape",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # عضو مرتبط با رویداد (مثلاً تولد چه کسی)
    for_member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'event'"))
    activity_status: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
