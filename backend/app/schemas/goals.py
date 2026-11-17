"""Explicit private Goal/Wish contracts; ownership and ciphertext are server-owned."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.meals import calendar_day

GoalKind = Literal["goal", "wish"]
GoalStatus = Literal["active", "done"]


class GoalContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=2000)


class GoalWrite(GoalContent):
    kind: GoalKind = "goal"
    target_date: date | None = None
    status: GoalStatus = "active"
    reminder_enabled: bool = Field(default=True, strict=True)

    @field_validator("target_date", mode="before")
    @classmethod
    def valid_day(cls, value):
        return None if value is None else calendar_day(value)


class GoalUpdate(GoalWrite):
    base_revision: int = Field(ge=1, strict=True)


class GoalOut(BaseModel):
    id: str
    owner_id: str
    kind: GoalKind
    title: str
    note: str | None
    target_date: date | None
    status: GoalStatus
    reminder_enabled: bool
    revision: int
    created_at: datetime
    updated_at: datetime


class GoalListOut(BaseModel):
    goals: list[GoalOut]
    can_create: bool
