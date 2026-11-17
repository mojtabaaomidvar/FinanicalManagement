"""Online-only goals: active members manage only their own private records."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.document_scope import bind_member, clear_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.goals import GoalListOut, GoalOut, GoalUpdate, GoalWrite
from app.services import goals


def goal_member(
    response: Response,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> Iterator[Member]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    goals.require_active(member)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


router = APIRouter(prefix="/goals", tags=["goals"])
TenantMember = Annotated[Member, Depends(goal_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=GoalListOut)
def list_goals(member: TenantMember, db: DbSession):
    return goals.list_goals(db, member)


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(body: GoalWrite, member: TenantMember, db: DbSession):
    return goals.create(db, member, body)


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: uuid.UUID, member: TenantMember, db: DbSession):
    return goals.get(db, member, goal_id)


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: uuid.UUID, body: GoalUpdate, member: TenantMember, db: DbSession):
    return goals.update(db, member, goal_id, body)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    goals.remove(db, member, goal_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})
