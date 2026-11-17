"""Sensitive household documents; free text is encrypted with the file key."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HouseholdDocument(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_documents_id_family"),
        CheckConstraint("visibility IN ('private','shared')", name="document_visibility"),
        CheckConstraint("revision >= 1", name="document_revision_positive"),
        CheckConstraint("file_size > 0 AND file_size <= 10485760", name="document_file_size"),
        Index("ix_documents_family_expiry", "family_id", "expiry_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    encrypted_metadata: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    visibility: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'private'"))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
