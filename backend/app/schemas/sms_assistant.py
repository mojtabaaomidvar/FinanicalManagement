"""Contracts for AI-assisted SMS extraction and its separately confirmed import."""

from __future__ import annotations

from datetime import date as _date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SmsAssistantInput(BaseModel):
    raw_text: str = Field(min_length=1, max_length=4000)


class SmsAssistantAnalyzeIn(BaseModel):
    items: list[SmsAssistantInput] = Field(min_length=1, max_length=8)


class SmsAssistantProposal(BaseModel):
    source_index: int = Field(ge=0, le=7)
    candidate_index: int = Field(ge=0, le=9)
    candidate_total: int = Field(ge=1, le=10)
    raw_text: str = Field(min_length=1, max_length=4000)
    type: Literal["expense", "income"]
    amount: Decimal | None = Field(default=None, gt=0, le=999999999999, allow_inf_nan=False)
    amount_unit: Literal["rial", "toman"] | None = None
    bank: str | None = Field(default=None, max_length=80)
    date: _date | None = None
    category: str | None = Field(default=None, max_length=80)
    account_id: str | None = None
    account_title: str | None = None
    account_match: Literal[
        "card", "card_tail", "account_number", "iban", "sender", "unique_bank"
    ] | None = None
    confidence: float = Field(ge=0, le=1)


class SmsAssistantImportCandidate(BaseModel):
    source_index: int = Field(ge=0, le=7)
    candidate_index: int = Field(ge=0, le=9)
    candidate_total: int = Field(ge=1, le=10)
    raw_text: str = Field(min_length=1, max_length=4000)
    type: Literal["expense", "income"]
    amount: Decimal | None = Field(default=None, gt=0, le=999999999999, allow_inf_nan=False)
    amount_unit: Literal["rial", "toman"] | None = None
    bank: str | None = Field(default=None, max_length=80)
    date: _date | None = None
    category: str | None = Field(default=None, max_length=80)
    account_id: str | None = None


class SmsAssistantImportIn(BaseModel):
    operation_id: UUID
    candidates: list[SmsAssistantImportCandidate] = Field(min_length=1, max_length=80)
