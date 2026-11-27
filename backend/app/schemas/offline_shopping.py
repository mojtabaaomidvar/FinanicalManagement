"""Explicit allowlist for data that may be stored in the offline household cache."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.schemas.tasks import TaskCompletePayload, TaskOut, TaskWrite


class OfflineItemOut(BaseModel):
    id: str
    list_id: str
    title: str
    qty: Decimal
    unit: str | None
    checked: bool
    inventory_item_id: str | None
    note: str | None
    revision: int
    created_at: datetime

    @field_serializer("qty")
    def serialize_qty(self, value: Decimal) -> float:
        return float(value)


class OfflineListOut(BaseModel):
    id: str
    title: str
    revision: int
    created_at: datetime
    items: list[OfflineItemOut]


class OfflineInventoryOut(BaseModel):
    id: str
    title: str
    unit: str | None
    quantity: Decimal
    catalog_id: str | None = None
    category: str | None
    note: str | None
    revision: int
    created_at: datetime
    updated_at: datetime

    @field_serializer("quantity")
    def serialize_qty(self, value: Decimal) -> float:
        return float(value)


class OfflineTaskNotificationPrefs(BaseModel):
    enabled: bool
    tasks_enabled: bool
    lead_days: int = Field(ge=0, le=60)


class OfflineSnapshot(BaseModel):
    lists: list[OfflineListOut]
    inventory: list[OfflineInventoryOut]
    tasks: list[TaskOut] = Field(default_factory=list)
    task_notification_prefs: OfflineTaskNotificationPrefs | None = None


class _Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class _Empty(_Payload):
    pass


class _ListWrite(_Payload):
    title: str = Field(min_length=1, max_length=120)


class _ItemWrite(_Payload):
    title: str = Field(min_length=1, max_length=120)
    qty: Decimal = Field(default=Decimal(1), gt=0, le=99999999)
    unit: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=500)
    inventory_item_id: uuid.UUID | None = None


class _ItemCreate(_ItemWrite):
    list_id: uuid.UUID


class _ItemCheck(_Payload):
    checked: bool = Field(strict=True)


class _InventoryWrite(_Payload):
    title: str = Field(min_length=1, max_length=120)
    quantity: Decimal = Field(default=Decimal(0), ge=0, le=99999999)
    category: str | None = Field(default=None, max_length=40)
    unit: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="before")
    @classmethod
    def accept_retired_outbox_field(cls, value):
        # Old encrypted commands must retain their exact payload/hash for replay.
        # Ignore only the retired field at validation; never rewrite the request.
        if isinstance(value, dict) and "threshold" in value:
            value = {key: item for key, item in value.items() if key != "threshold"}
        return value


class _InventoryAdjust(_Payload):
    delta: Decimal = Field(ge=-99999999, le=99999999)


_PAYLOADS = {
    "list.create": _ListWrite,
    "list.update": _ListWrite,
    "list.delete": _Empty,
    "item.create": _ItemCreate,
    "item.update": _ItemWrite,
    "item.check": _ItemCheck,
    "item.delete": _Empty,
    "inventory.create": _InventoryWrite,
    "inventory.update": _InventoryWrite,
    "inventory.adjust": _InventoryAdjust,
    "inventory.delete": _Empty,
    "task.create": TaskWrite,
    "task.update": TaskWrite,
    "task.complete": TaskCompletePayload,
    "task.delete": _Empty,
}


class OfflineMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: uuid.UUID
    kind: Literal[
        "list.create",
        "list.update",
        "list.delete",
        "item.create",
        "item.update",
        "item.check",
        "item.delete",
        "inventory.create",
        "inventory.update",
        "inventory.adjust",
        "inventory.delete",
        "task.create",
        "task.update",
        "task.complete",
        "task.delete",
    ]
    entity_id: uuid.UUID
    base_revision: int | None = Field(default=None, ge=1, strict=True)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_payload(self) -> OfflineMutation:
        _PAYLOADS[self.kind].model_validate(self.payload)
        if self.kind.endswith(".create") != (self.base_revision is None):
            raise ValueError("Create requires null base_revision; other writes need a revision.")
        return self

    def data(self) -> dict[str, Any]:
        data = _PAYLOADS[self.kind].model_validate(self.payload).model_dump()
        if self.kind in ("inventory.create", "inventory.update") and "category" not in self.payload:
            data.pop("category", None)  # Old queued edits must not erase a saved custom category.
        return data


class OfflineMutationResult(BaseModel):
    operation_id: str
    replayed: bool
    entity_type: Literal["list", "item", "inventory", "task"]
    entity_id: str
    revision: int | None
    snapshot: OfflineSnapshot
