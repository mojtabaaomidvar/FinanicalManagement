from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

CatalogStatus = Literal["pending", "approved", "rejected"]


class CatalogProposalOut(BaseModel):
    id: str
    title: str
    category: str
    unit: str | None
    status: CatalogStatus
    submitted_at: datetime
    reviewed_at: datetime | None
    published_at: datetime | None = None


class CatalogProposals(BaseModel):
    items: list[CatalogProposalOut]
    total: int
    offset: int
    limit: int


class CatalogReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    status: Literal["approved", "rejected"]
    title: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = None
    unit: str | None = Field(default=None, max_length=20)


class CatalogEntryOut(BaseModel):
    id: str
    catalog_id: str
    title: str
    group: str
    unit: str
    aliases: list[str] = Field(default_factory=list)
    common: bool = False
