"""Online shared activities bind active member context across commits."""

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
from app.schemas.activities import ActivityListOut, ActivityOut, ActivityUpdate, ActivityWrite
from app.services import activities


def activity_member(
    response: Response,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> Iterator[Member]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    activities.require_active(member)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


router = APIRouter(prefix="/activities", tags=["activities"])
TenantMember = Annotated[Member, Depends(activity_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=ActivityListOut)
def list_activities(member: TenantMember, db: DbSession):
    return activities.list_activities(db, member)


@router.post("", response_model=ActivityOut, status_code=status.HTTP_201_CREATED)
def create_activity(body: ActivityWrite, member: TenantMember, db: DbSession):
    return activities.create(db, member, body)


@router.get("/{activity_id}", response_model=ActivityOut)
def get_activity(activity_id: uuid.UUID, member: TenantMember, db: DbSession):
    return activities.get(db, member, activity_id)


@router.patch("/{activity_id}", response_model=ActivityOut)
def update_activity(
    activity_id: uuid.UUID, body: ActivityUpdate, member: TenantMember, db: DbSession
):
    return activities.update(db, member, activity_id, body)


@router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(
    activity_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    activities.remove(db, member, activity_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})
