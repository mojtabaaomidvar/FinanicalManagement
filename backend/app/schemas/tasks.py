"""The same narrow task fields serve the online API and encrypted offline cache."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import settings


class TaskOut(BaseModel):
    id: str
    title: str
    description: str | None
    assignee_id: str | None
    due_date: date | None
    completed: bool
    completed_at: datetime | None
    completed_by: str | None
    completion_photo_url: str | None
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class TaskWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None

    @field_validator("due_date", mode="before")
    @classmethod
    def validate_day(cls, value):
        if value is None or (isinstance(value, date) and not isinstance(value, datetime)):
            return value
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("Due date must be a calendar day in YYYY-MM-DD format.")
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError("Due date must be a calendar day in YYYY-MM-DD format.")
        return parsed


class TaskUpdate(TaskWrite):
    base_revision: int = Field(ge=1, strict=True)


class TaskCompletePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed: bool = Field(strict=True)
    completion_photo: str | None = Field(
        default=None,
        strict=True,
        max_length=4 * ((settings.upload_max_bytes + 2) // 3) + 32,
    )

    @model_validator(mode="after")
    def photo_requires_completion(self) -> TaskCompletePayload:
        if not self.completed and self.completion_photo is not None:
            raise ValueError("A completion photo can only be supplied when completing a task.")
        return self


class TaskComplete(TaskCompletePayload):
    base_revision: int = Field(ge=1, strict=True)
