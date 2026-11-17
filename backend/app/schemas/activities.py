"""Strict shared activity input, with family and creator assigned by the server."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.meals import calendar_day

ActivityStatus = Literal["planned", "done", "cancelled"]


class ActivityWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
    date: date
    location: str | None = Field(default=None, max_length=180)
    status: ActivityStatus = "planned"
    participant_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    reminder_enabled: bool = Field(default=True, strict=True)

    @field_validator("date", mode="before")
    @classmethod
    def valid_day(cls, value):
        return calendar_day(value)

    @field_validator("participant_ids")
    @classmethod
    def unique_participants(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Participants must be unique.")
        return value


class ActivityUpdate(ActivityWrite):
    base_revision: int = Field(ge=1, strict=True)


class ActivityOut(BaseModel):
    id: str
    title: str
    note: str | None
    date: date
    location: str | None
    status: ActivityStatus
    participant_ids: list[str]
    reminder_enabled: bool
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class ActivityListOut(BaseModel):
    activities: list[ActivityOut]
    can_create: bool
