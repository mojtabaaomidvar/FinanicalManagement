"""Shared household dishes and fixed daily meal slots."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Dish(Base):
    __tablename__ = "meal_dishes"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_meal_dishes_id_family"),
        CheckConstraint("revision >= 1", name="meal_dish_revision_positive"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="meal_dish_title_length"),
        CheckConstraint(
            "jsonb_typeof(ingredients) = 'array' AND jsonb_array_length(ingredients) <= 50",
            name="meal_dish_ingredients_array",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    ingredients: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MealEntry(Base):
    __tablename__ = "meal_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["dish_id", "family_id"],
            ["meal_dishes.id", "meal_dishes.family_id"],
            ondelete="NO ACTION",
            name="fk_meal_entry_dish_family",
        ),
        UniqueConstraint("family_id", "date", "meal_type", name="uq_meal_entries_family_slot"),
        CheckConstraint("revision >= 1", name="meal_entry_revision_positive"),
        CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')", name="meal_entry_type_valid"
        ),
        Index("ix_meal_entries_family_date", "family_id", "date"),
        Index("ix_meal_entries_dish_family", "dish_id", "family_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    meal_type: Mapped[str] = mapped_column(Text, nullable=False)
    dish_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
