"""Narrow online-only document API; ownership and storage paths are not inputs."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentOut(BaseModel):
    id: str
    title: str
    category: str | None
    visibility: Literal["private", "shared"]
    expiry_date: date | None
    reminder_enabled: bool
    owner_id: str
    mime_type: str
    file_name: str
    file_size: int
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool
    can_change_visibility: bool


class DocumentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=80)
    visibility: Literal["private", "shared"] = "private"
    expiry_date: date | None = None
    reminder_enabled: bool = True

    @field_validator("expiry_date", mode="before")
    @classmethod
    def validate_day(cls, value):
        if value is None or (isinstance(value, date) and not isinstance(value, datetime)):
            return value
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("Expiry must be an ISO calendar day.")
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError("Expiry must be an ISO calendar day.")
        return parsed


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=1, strict=True)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=80)
    visibility: Literal["private", "shared"] | None = None
    expiry_date: date | None = None
    reminder_enabled: bool | None = Field(default=None, strict=True)

    _validate_day = field_validator("expiry_date", mode="before")(
        DocumentWrite.validate_day.__func__
    )

    @field_validator("title", "visibility", "reminder_enabled", mode="before")
    @classmethod
    def required_when_present(cls, value):
        if value is None:
            raise ValueError("This field cannot be null.")
        return value
