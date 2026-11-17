"""Explicit online vehicle and service contracts, with Finance-owned amounts."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.equipment import MaintenanceWrite
from app.schemas.meals import calendar_day


class VehicleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    brand: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    plate: str | None = Field(default=None, max_length=30)
    purchase_date: date | None = None
    odometer: int = Field(default=0, ge=0, le=100000000, strict=True)
    insurance_until: date | None = None
    inspection_until: date | None = None
    document_id: uuid.UUID | None = None
    service_task_id: uuid.UUID | None = None
    service_due_date: date | None = None
    service_due_odometer: int | None = Field(default=None, ge=0, le=100000000, strict=True)
    service_reminder_enabled: bool = Field(default=True, strict=True)

    @field_validator(
        "purchase_date", "insurance_until", "inspection_until", "service_due_date", mode="before"
    )
    @classmethod
    def valid_day(cls, value):
        return None if value is None else calendar_day(value)


class VehicleUpdate(VehicleWrite):
    base_revision: int = Field(ge=1, strict=True)


class VehicleOut(BaseModel):
    id: str
    title: str
    brand: str | None
    model: str | None
    plate: str | None
    purchase_date: date | None
    odometer: int
    insurance_until: date | None
    inspection_until: date | None
    document_id: str | None
    service_task_id: str | None
    service_due_date: date | None
    service_due_odometer: int | None
    service_reminder_enabled: bool
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool
    can_view_history: bool


class VehicleListOut(BaseModel):
    vehicles: list[VehicleOut]
    can_create: bool


class VehicleServiceWrite(MaintenanceWrite):
    performed_odometer: int = Field(ge=0, le=100000000, strict=True)
    next_due_odometer: int | None = Field(default=None, ge=0, le=100000000, strict=True)
    cost_amount: Decimal | None = Field(
        default=None, gt=0, le=Decimal("999999999999"), max_digits=15, decimal_places=2
    )
    account_id: uuid.UUID | None = None

    @field_validator("cost_amount", mode="before")
    @classmethod
    def amount_is_number(cls, value):
        if isinstance(value, bool):
            raise ValueError("Cost must be a number.")
        return value

    @model_validator(mode="after")
    def consistent_details(self):
        if self.next_due_odometer is not None and self.next_due_odometer <= self.performed_odometer:
            raise ValueError("Next service odometer must exceed performed odometer.")
        if self.account_id is not None and self.cost_amount is None:
            raise ValueError("An account requires a service cost.")
        return self


class VehicleServiceOut(BaseModel):
    id: str
    vehicle_id: str
    performed_on: date
    description: str
    performed_odometer: int
    next_due_date: date | None
    next_due_odometer: int | None
    transaction_id: str | None
    cost_amount: Decimal | None
    cost_status: Literal["none", "recorded", "unavailable"]
    created_by: str | None
    created_at: datetime


class VehicleServiceResult(BaseModel):
    vehicle: VehicleOut
    record: VehicleServiceOut
    replayed: bool
