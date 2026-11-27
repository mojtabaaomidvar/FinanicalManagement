"""Online-only shared meals; every route establishes active tenant membership."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.meals import (
    DishOut,
    DishUpdate,
    DishWrite,
    IngredientCheck,
    IngredientReviewRequest,
    MealEntryOut,
    MealEntryUpdate,
    MealEntryWrite,
    MealPlanOut,
    MealSelectionOut,
    MealSelectionWrite,
)
from app.services import meals

router = APIRouter(prefix="/meals", tags=["meals"])
TenantMember = Annotated[Member, Depends(get_tenant_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.post("/ingredients/check", response_model=list[IngredientCheck])
def check_ingredients(body: IngredientReviewRequest, member: TenantMember, db: DbSession):
    return meals.review_ingredients(db, member, body.ingredients)


@router.post("/plan/confirm", response_model=MealSelectionOut)
def confirm_selection(body: MealSelectionWrite, member: TenantMember, db: DbSession):
    return meals.commit_selection(db, member, body)


@router.get("/dishes", response_model=list[DishOut])
def list_dishes(member: TenantMember, db: DbSession):
    return meals.list_dishes(db, member)


@router.post("/dishes", response_model=DishOut, status_code=status.HTTP_201_CREATED)
def create_dish(body: DishWrite, member: TenantMember, db: DbSession):
    return meals.create_dish(db, member, body)


@router.patch("/dishes/{dish_id}", response_model=DishOut)
def update_dish(dish_id: uuid.UUID, body: DishUpdate, member: TenantMember, db: DbSession):
    return meals.update_dish(db, member, dish_id, body.base_revision, body)


@router.delete("/dishes/{dish_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dish(
    dish_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    meals.delete_dish(db, member, dish_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/plan", response_model=MealPlanOut)
def get_plan(
    week_start: Annotated[str, Query(min_length=10, max_length=10)],
    member: TenantMember,
    db: DbSession,
):
    return meals.plan(db, member, meals.week_start(week_start))


@router.post("/plan", response_model=MealEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(body: MealEntryWrite, member: TenantMember, db: DbSession):
    return meals.create_entry(db, member, body)


@router.patch("/plan/{entry_id}", response_model=MealEntryOut)
def update_entry(entry_id: uuid.UUID, body: MealEntryUpdate, member: TenantMember, db: DbSession):
    return meals.update_entry(db, member, entry_id, body)


@router.delete("/plan/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    meals.delete_entry(db, member, entry_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
