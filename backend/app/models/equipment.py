"""Home equipment and append-only maintenance shared with household vehicles."""

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


class Equipment(Base):
    __tablename__ = "home_equipment"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_home_equipment_id_family"),
        # The migration uses column-specific SET NULL for the optional id only.
        ForeignKeyConstraint(
            ["warranty_document_id", "family_id"],
            ["documents.id", "documents.family_id"],
            name="fk_equipment_document_family",
        ),
        ForeignKeyConstraint(
            ["service_task_id", "family_id"],
            ["tasks.id", "tasks.family_id"],
            name="fk_equipment_task_family",
        ),
        CheckConstraint("revision >= 1", name="equipment_revision_positive"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="equipment_title_length"),
        CheckConstraint("brand IS NULL OR char_length(brand) <= 80", name="equipment_brand_length"),
        CheckConstraint("model IS NULL OR char_length(model) <= 80", name="equipment_model_length"),
        CheckConstraint(
            "purchase_date IS NULL OR warranty_until IS NULL OR warranty_until >= purchase_date",
            name="equipment_warranty_after_purchase",
        ),
        Index("ix_home_equipment_family_due", "family_id", "service_due_date"),
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
    purchase_date: Mapped[date | None] = mapped_column(Date)
    warranty_until: Mapped[date | None] = mapped_column(Date)
    warranty_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    service_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    service_due_date: Mapped[date | None] = mapped_column(Date)
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


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    __table_args__ = (
        ForeignKeyConstraint(
            ["equipment_id", "family_id"],
            ["home_equipment.id", "home_equipment.family_id"],
            ondelete="CASCADE",
            name="fk_maintenance_equipment_family",
        ),
        ForeignKeyConstraint(
            ["vehicle_id", "family_id"],
            ["vehicles.id", "vehicles.family_id"],
            ondelete="CASCADE",
            name="fk_maintenance_vehicle_family",
        ),
        ForeignKeyConstraint(
            ["transaction_id", "family_id"],
            ["transactions.id", "transactions.family_id"],
            name="fk_maintenance_transaction_family",
        ),
        CheckConstraint(
            "num_nonnulls(equipment_id, vehicle_id) = 1", name="maintenance_one_target"
        ),
        CheckConstraint(
            "(equipment_id IS NOT NULL AND performed_odometer IS NULL "
            "AND next_due_odometer IS NULL "
            "AND transaction_id IS NULL AND NOT had_cost) OR (vehicle_id IS NOT NULL AND "
            "performed_odometer IS NOT NULL AND performed_odometer BETWEEN 0 AND 100000000 "
            "AND (next_due_odometer IS NULL OR "
            "(next_due_odometer > performed_odometer AND next_due_odometer <= 100000000)))",
            name="maintenance_vehicle_details",
        ),
        CheckConstraint("transaction_id IS NULL OR had_cost", name="maintenance_cost_link"),
        UniqueConstraint("family_id", "operation_id", name="uq_maintenance_family_operation"),
        CheckConstraint(
            "char_length(description) BETWEEN 1 AND 1000", name="maintenance_description_length"
        ),
        CheckConstraint(
            "next_due_date IS NULL OR next_due_date > performed_on", name="maintenance_next_date"
        ),
        Index("ix_maintenance_equipment_performed", "equipment_id", "performed_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    equipment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    performed_odometer: Mapped[int | None] = mapped_column(Integer)
    next_due_odometer: Mapped[int | None] = mapped_column(Integer)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    had_cost: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    performed_on: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    next_due_date: Mapped[date | None] = mapped_column(Date)
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
