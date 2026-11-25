"""Exact decimal JSON boundary for wallet operations."""
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer


def decimal_text(value: Decimal) -> str:
    value_text = format(value, "f")
    return (value_text.rstrip("0").rstrip(".") if "." in value_text else value_text) if value else "0"


class CorrectionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    base_revision: int = Field(ge=0)
    target_balance: Decimal = Field(ge=Decimal("-999999999999999"), le=Decimal("999999999999999"), decimal_places=2)
    mode: Literal["ledger", "reconciliation"]
    description: str | None = Field(default=None, max_length=200)


class WalletBalanceOut(BaseModel):
    account_id: str
    revision: int
    ledger_balance: Decimal
    current_balance: Decimal
    discrepancy: Decimal
    active_reconciliation_id: str | None

    @field_serializer("ledger_balance", "current_balance", "discrepancy")
    def serialize_money(self, value: Decimal) -> str:
        return decimal_text(value)


class CorrectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    family_id: UUID
    account_id: UUID
    created_by: UUID
    operation_id: UUID
    mode: str
    revision: int
    target_balance: Decimal
    ledger_before: Decimal
    current_before: Decimal
    ledger_after: Decimal
    current_after: Decimal
    delta: Decimal
    description: str | None
    transaction_id: UUID | None
    created_at: datetime

    @field_serializer("target_balance", "ledger_before", "current_before", "ledger_after", "current_after", "delta")
    def serialize_money(self, value: Decimal) -> str:
        return decimal_text(value)
