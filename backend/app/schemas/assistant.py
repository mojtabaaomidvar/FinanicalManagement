"""Context reports and separately confirmed actions; financial writes stay in their forms."""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.services.household_ai_protocol import NarrowModel, Scope


class AssistantAnalyzeIn(NarrowModel):
    text: str = Field(min_length=1, max_length=8000)
    scope: Scope = "auto"


class ContextAnalyzeIn(NarrowModel):
    text: str = Field(min_length=1, max_length=8000)


class PrepareActionIn(NarrowModel):
    report_token: str = Field(min_length=1, max_length=64000)
    action_id: str = Field(min_length=1, max_length=64)
    list_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    qty: Decimal | None = Field(default=None, ge=Decimal("0.01"), le=99999999,
                                allow_inf_nan=False)
    unit: str | None = Field(default=None, max_length=20)
    assignee_id: UUID | None = None
    due_date: date | None = None
    meal_type: Literal["breakfast", "lunch", "dinner"] | None = None


class ExecuteActionIn(NarrowModel):
    review_token: str = Field(min_length=1, max_length=16000)
    confirmed: Literal[True]
