"""Online-only, atomic addition of selected recipe ingredients to shopping."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ShoppingBatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    title: str = Field(min_length=1, max_length=120)
    qty: Decimal = Field(gt=0, le=99999999)
    unit: str | None = Field(default=None, max_length=20)


class ShoppingBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: uuid.UUID
    items: list[ShoppingBatchItem] = Field(min_length=1, max_length=250)


class ShoppingBatchAdded(BaseModel):
    id: str
    title: str
    qty: Decimal
    unit: str | None


class ShoppingBatchSkipped(BaseModel):
    id: str
    title: str


class ShoppingBatchResult(BaseModel):
    operation_id: str
    list_id: str
    replayed: bool
    added: list[ShoppingBatchAdded]
    skipped: list[ShoppingBatchSkipped]
    added_count: int
    skipped_count: int
