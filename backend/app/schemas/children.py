"""Children expose a narrow projection of the canonical member and shared records."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.meals import calendar_day


class ChildWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=40)
    birth_date: date | None

    @field_validator("birth_date", mode="before")
    @classmethod
    def valid_day(cls, value):
        return None if value is None else calendar_day(value)


class ChildUpdate(ChildWrite):
    base_revision: int = Field(ge=1, strict=True)


class ChildOut(BaseModel):
    id: str
    name: str
    birth_date: date | None
    age_years: int | None
    status: Literal["pending", "active"]
    revision: int
    can_edit: bool


class ChildListOut(BaseModel):
    children: list[ChildOut]
    can_create: bool


class ChildTaskOut(BaseModel):
    id: str
    title: str
    due_date: date | None
    completed: bool


class ChildActivityOut(BaseModel):
    id: str
    title: str
    date: date
    location: str | None
    status: Literal["planned", "done", "cancelled"]


class ChildBirthdayOut(BaseModel):
    id: str
    title: str
    date: date


class ChildDetailOut(BaseModel):
    child: ChildOut
    tasks: list[ChildTaskOut]
    activities: list[ChildActivityOut]
    birthday: ChildBirthdayOut | None
