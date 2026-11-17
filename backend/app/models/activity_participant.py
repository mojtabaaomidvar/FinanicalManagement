"""A member's participation in the same canonical family activity."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, ForeignKeyConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ActivityParticipant(Base):
    __tablename__ = "activity_participants"
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "family_id"],
            ["family_events.id", "family_events.family_id"],
            name="fk_activity_participant_event_family",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["member_id", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_activity_participant_member_family",
            ondelete="CASCADE",
        ),
    )

    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
