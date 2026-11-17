"""Narrow input contracts for online equipment and completed services."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.meals import calendar_day


class EquipmentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    brand: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    purchase_date: date | None = None
    warranty_until: date | None = None
    warranty_document_id: uuid.UUID | None = None
    service_task_id: uuid.UUID | None = None
    service_due_date: date | None = None
    service_reminder_enabled: bool = Field(default=True, strict=True)

    @field_validator("purchase_date", "warranty_until", "service_due_date", mode="before")
    @classmethod
    def validate_day(cls, value):
        return None if value is None else calendar_day(value)

    @model_validator(mode="after")
    def date_order(self):
        if self.purchase_date and self.warranty_until and self.warranty_until < self.purchase_date:
            raise ValueError("Warranty expiry cannot precede purchase.")
        return self


class EquipmentUpdate(EquipmentWrite):
    base_revision: int = Field(ge=1, strict=True)


class EquipmentOut(BaseModel):
    id: str
    title: str
    brand: str | None
    model: str | None
    purchase_date: date | None
    warranty_until: date | None
    warranty_document_id: str | None
    service_task_id: str | None
    service_due_date: date | None
    service_reminder_enabled: bool
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class MaintenanceWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: uuid.UUID
    base_revision: int = Field(ge=1, strict=True)
    performed_on: date
    description: str = Field(min_length=1, max_length=1000)
    next_due_date: date | None = None

    @field_validator("performed_on", "next_due_date", mode="before")
    @classmethod
    def validate_day(cls, value):
        return None if value is None else calendar_day(value)

    @model_validator(mode="after")
    def next_service_after_completion(self):
        if self.next_due_date and self.next_due_date <= self.performed_on:
            raise ValueError("Next service must follow completion.")
        return self


class MaintenanceOut(BaseModel):
    id: str
    equipment_id: str
    performed_on: date
    description: str
    next_due_date: date | None
    created_by: str | None
    created_at: datetime


class MaintenanceResult(BaseModel):
    equipment: EquipmentOut
    record: MaintenanceOut
    replayed: bool
