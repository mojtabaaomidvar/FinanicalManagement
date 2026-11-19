"""Explicit support projections; user and financial models are never serialized."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MembershipState = Literal["pending", "active", "rejected", "expired", "suspended", "removed"]
RegistrationState = Literal["registered", "introduced", "managed"]


class SupportLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class SupportSessionOut(BaseModel):
    authenticated: bool


class SupportUser(BaseModel):
    support_code: UUID
    created_at: datetime
    registration_state: RegistrationState
    membership_state: MembershipState


class SupportUsers(BaseModel):
    items: list[SupportUser]
    total: int
    offset: int
    limit: int


class SupportDay(BaseModel):
    day: str
    registrations: int


class SupportOverview(BaseModel):
    registered: int
    introduced: int
    managed: int
    awaiting_approval: int
    active: int
    new_registrations: int
    daily: list[SupportDay]
    checked_at: datetime


class SupportTechnical(BaseModel):
    api: Literal["available"]
    database: Literal["available"]
    sms: Literal["configured", "disabled"]
    login_errors: int
    registration_errors: int
    server_errors: int
    measured_hours: int
    checked_at: datetime


class OwnSupportCode(BaseModel):
    support_code: UUID
