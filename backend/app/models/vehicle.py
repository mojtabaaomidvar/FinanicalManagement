"""A canonical household vehicle with online maintenance scheduling."""

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
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_vehicles_id_family"),
        ForeignKeyConstraint(
            ["document_id", "family_id"],
            ["documents.id", "documents.family_id"],
            name="fk_vehicle_document_family",
        ),
        ForeignKeyConstraint(
            ["service_task_id", "family_id"],
            ["tasks.id", "tasks.family_id"],
            name="fk_vehicle_task_family",
        ),
        CheckConstraint("revision >= 1", name="vehicle_revision_positive"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="vehicle_title_length"),
        CheckConstraint("brand IS NULL OR char_length(brand) <= 80", name="vehicle_brand_length"),
        CheckConstraint("model IS NULL OR char_length(model) <= 80", name="vehicle_model_length"),
        CheckConstraint("plate IS NULL OR char_length(plate) <= 30", name="vehicle_plate_length"),
        CheckConstraint("odometer BETWEEN 0 AND 100000000", name="vehicle_odometer_range"),
        CheckConstraint(
            "service_due_odometer IS NULL OR service_due_odometer BETWEEN 0 AND 100000000",
            name="vehicle_next_odometer_range",
        ),
        Index("ix_vehicles_family_due", "family_id", "service_due_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    brand: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    plate: Mapped[str | None] = mapped_column(Text)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    odometer: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    insurance_until: Mapped[date | None] = mapped_column(Date)
    inspection_until: Mapped[date | None] = mapped_column(Date)
    document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    service_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    service_due_date: Mapped[date | None] = mapped_column(Date)
    service_due_odometer: Mapped[int | None] = mapped_column(Integer)
    service_reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
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
