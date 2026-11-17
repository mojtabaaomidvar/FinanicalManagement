"""Household pet profiles; care stays in canonical Task rows."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
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


class Pet(Base):
    __tablename__ = "pets"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_pets_id_family"),
        ForeignKeyConstraint(
            ["created_by", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_pet_creator_family",
        ),
        CheckConstraint("revision >= 1", name="pet_revision_positive"),
        CheckConstraint("char_length(name) BETWEEN 1 AND 80", name="pet_name_length"),
        CheckConstraint("char_length(species) BETWEEN 1 AND 60", name="pet_species_length"),
        CheckConstraint("breed IS NULL OR char_length(breed) <= 100", name="pet_breed_length"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    species: Mapped[str] = mapped_column(Text, nullable=False)
    breed: Mapped[str | None] = mapped_column(Text)
    birth_date: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
