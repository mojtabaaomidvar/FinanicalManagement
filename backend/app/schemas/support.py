"""Explicit support projections; user and financial models are never serialized."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MembershipState = Literal["pending", "active", "rejected", "expired", "suspended", "removed"]
RegistrationState = Literal["registered", "introduced", "managed"]
SupportStage = Literal["registration_required", "managed_profile", "approval_pending", "ready", "inactive"]
SupportAttention = Literal["registration_incomplete", "managed_profile", "waiting_approval", "rejected", "expired", "suspended", "removed"]
UsageModule = Literal["dashboard", "transactions", "accounts", "budgets", "bills", "reports", "calendar",
    "shopping", "inventory", "tasks", "documents", "meals", "equipment", "vehicles", "goals",
    "activities", "children", "pets", "market", "settings", "notifications"]


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
    registered_at: datetime | None
    last_login_at: datetime | None
    stage: SupportStage
    attention_reason: SupportAttention | None


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


class UsageOpen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    module: UsageModule


class SupportModuleUsage(BaseModel):
    module: UsageModule
    opens: int
    creates: int
    updates: int
    completes: int
    deletes: int


class SupportUsageDay(BaseModel):
    day: str
    opens: int
    operations: int


class SupportRecordCounts(BaseModel):
    transactions: int = Field(ge=0)
    scheduled_plans: int = Field(ge=0)
    open_tasks: int = Field(ge=0)
    completed_tasks: int = Field(ge=0)
    shopping_lists: int = Field(ge=0)
    documents: int = Field(ge=0)


class SupportUsage(BaseModel):
    days: int
    modules: list[SupportModuleUsage]
    daily: list[SupportUsageDay]
    records: SupportRecordCounts
    measured_since: datetime | None
    checked_at: datetime
