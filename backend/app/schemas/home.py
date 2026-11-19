"""Personal Home arrangement: module IDs only, never family or profile data."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

HomeModuleId = Literal[
    "finance", "transactions", "accounts", "budgets", "bills", "market", "reports",
    "chores", "shopping", "inventory", "meals", "equipment", "vehicles", "docs",
    "calendar", "activities", "children", "pets", "goals", "sms",
]
HomeGroupId = Literal["money", "daily", "belongings", "family"]
_MODULE_IDS = {
    "finance", "transactions", "accounts", "budgets", "bills", "market", "reports",
    "chores", "shopping", "inventory", "meals", "equipment", "vehicles", "docs",
    "calendar", "activities", "children", "pets", "goals",
}
_GROUP_IDS = {"money", "daily", "belongings", "family"}
ModuleList = Annotated[list[HomeModuleId], Field(max_length=20)]


class HomeGroupModules(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    money: ModuleList
    daily: ModuleList
    belongings: ModuleList
    family: ModuleList


class HomePreferences(BaseModel):
    # Camel-case keys intentionally match the versioned frontend arrangement.
    model_config = ConfigDict(extra="forbid", strict=True)

    version: int = Field(ge=1, le=1)
    layout: Literal["grouped", "flat"]
    pins: ModuleList
    openGroups: list[HomeGroupId] = Field(max_length=4)
    groupOrder: list[HomeGroupId] = Field(min_length=4, max_length=4)
    groupModules: HomeGroupModules
    flatOrder: list[HomeModuleId] = Field(min_length=19, max_length=20)

    @model_validator(mode="after")
    def complete_catalog(self) -> Self:
        if len(set(self.pins)) != len(self.pins):
            raise ValueError("Pinned modules must be unique")
        if len(set(self.openGroups)) != len(self.openGroups):
            raise ValueError("Open groups must be unique")
        if set(self.groupOrder) != _GROUP_IDS:
            raise ValueError("Group order must contain every group exactly once")
        catalog = set(self.flatOrder)
        if (not _MODULE_IDS.issubset(catalog) or not catalog.issubset(_MODULE_IDS | {"sms"})
                or len(self.flatOrder) != len(catalog)):
            raise ValueError("Flat order must contain every module exactly once")
        grouped = [
            module_id
            for group in self.groupModules.model_dump().values()
            for module_id in group
        ]
        if len(grouped) != len(catalog) or set(grouped) != catalog:
            raise ValueError("Grouped catalog must contain every module exactly once")
        if not set(self.pins).issubset(catalog):
            raise ValueError("Pinned modules must belong to the catalog")
        return self


class HomePreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    revision: int = Field(ge=0, le=2_147_483_646)
    preferences: HomePreferences


class HomePreferencesOut(BaseModel):
    revision: int
    # Reading remains tolerant of a previous registry/version; the frontend migrates it.
    preferences: dict | None
