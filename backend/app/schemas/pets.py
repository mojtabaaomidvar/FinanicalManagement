"""Pet profiles and narrow summaries of canonical care tasks."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.meals import calendar_day
from app.schemas.tasks import TaskWrite


class PetWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    species: str = Field(min_length=1, max_length=60)
    breed: str | None = Field(default=None, max_length=100)
    birth_date: date | None = None

    @field_validator("birth_date", mode="before")
    @classmethod
    def valid_day(cls, value):
        return None if value is None else calendar_day(value)


class PetUpdate(PetWrite):
    base_revision: int = Field(ge=1, strict=True)


class PetCareWrite(TaskWrite):
    base_revision: int = Field(ge=1, strict=True)
    operation_id: uuid.UUID


class PetOut(BaseModel):
    id: str
    name: str
    species: str
    breed: str | None
    birth_date: date | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class PetListOut(BaseModel):
    pets: list[PetOut]
    can_create: bool


class PetCareOut(BaseModel):
    id: str
    title: str
    assignee_id: str | None
    due_date: date | None
    completed: bool
    revision: int
    can_complete: bool


class PetDetailOut(BaseModel):
    pet: PetOut
    care_tasks: list[PetCareOut]
    can_create_care: bool
