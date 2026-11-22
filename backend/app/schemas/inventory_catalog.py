from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

CatalogStatus = Literal["pending", "approved", "rejected"]


class CatalogProposalOut(BaseModel):
    id: str
    title: str
    category: str
    unit: str | None
    status: CatalogStatus
    submitted_at: datetime
    reviewed_at: datetime | None


class CatalogProposals(BaseModel):
    items: list[CatalogProposalOut]
    total: int
    offset: int
    limit: int


class CatalogReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    status: Literal["approved", "rejected"]
