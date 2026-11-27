"""Meals V1 accepts only reusable dishes, ingredients and calendar slots."""

from __future__ import annotations

import uuid
from datetime import date as CalendarDate
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MealType = Literal["breakfast", "lunch", "dinner", "snack"]


def calendar_day(value) -> CalendarDate:
    if isinstance(value, CalendarDate) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Use a calendar day in YYYY-MM-DD format.")
    parsed = CalendarDate.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("Use a calendar day in YYYY-MM-DD format.")
    return parsed


class Ingredient(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    catalog_id: str | None = Field(default=None, max_length=160)
    # A named ingredient does not imply a known amount. Shopping has its own numeric schema.
    qty: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999"))
    unit: str | None = Field(default=None, max_length=20)

    @field_validator("qty", mode="before")
    @classmethod
    def quantity_is_number(cls, value):
        if isinstance(value, bool):
            raise ValueError("Quantity must be a number.")
        return value


class DishWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    ingredients: list[Ingredient] = Field(default_factory=list, max_length=50)


class DishUpdate(DishWrite):
    base_revision: int = Field(ge=1, strict=True)


class DishOut(BaseModel):
    id: str
    title: str
    ingredients: list[Ingredient]
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class MealEntryWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: CalendarDate
    meal_type: MealType
    dish_id: uuid.UUID

    @field_validator("date", mode="before")
    @classmethod
    def validate_day(cls, value):
        return calendar_day(value)


class MealEntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=1, strict=True)
    dish_id: uuid.UUID


class MealEntryOut(BaseModel):
    id: str
    date: CalendarDate
    meal_type: MealType
    dish_id: str
    created_by: str | None
    revision: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class MealPlanOut(BaseModel):
    week_start: CalendarDate
    entries: list[MealEntryOut]


class IngredientReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ingredients: list[Ingredient] = Field(max_length=50)


class IngredientCheck(BaseModel):
    key: str
    ingredient: Ingredient
    status: Literal["available", "missing", "unresolved"]


class IngredientDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=30)
    action: Literal["shopping", "available"]
    qty: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999"))
    unit: str | None = Field(default=None, max_length=20)

    @field_validator("qty", mode="before")
    @classmethod
    def quantity_is_number(cls, value):
        return Ingredient.quantity_is_number(value)


class MealSelectionWrite(BaseModel):
    """One confirmed gesture; dish, shopping rows and receipt commit together."""
    model_config = ConfigDict(extra="forbid")
    operation_id: uuid.UUID
    date: CalendarDate
    meal_type: MealType
    dish_id: uuid.UUID | None = None
    dish_revision: int | None = Field(default=None, ge=1, strict=True)
    dish: DishWrite | None = None
    entry_id: uuid.UUID | None = None
    base_revision: int | None = Field(default=None, ge=1, strict=True)
    list_id: uuid.UUID | None = None
    decisions: list[IngredientDecision] = Field(default_factory=list, max_length=50)

    @field_validator("date", mode="before")
    @classmethod
    def validate_day(cls, value):
        return calendar_day(value)

    @model_validator(mode="after")
    def validate_source(self):
        if (self.dish is None) == (self.dish_id is None):
            raise ValueError("Supply exactly one dish source.")
        if (self.dish_id is None) != (self.dish_revision is None):
            raise ValueError("An existing dish requires its reviewed revision.")
        if (self.entry_id is None) != (self.base_revision is None):
            raise ValueError("An existing entry requires its reviewed revision.")
        return self


class MealSelectionOut(BaseModel):
    entry: MealEntryOut
    dish: DishOut
    replayed: bool
    added_count: int
    skipped_count: int
