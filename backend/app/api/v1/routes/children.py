"""Online Children projections use authenticated family/member context."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.document_scope import bind_member, clear_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.children import ChildDetailOut, ChildListOut, ChildOut, ChildUpdate, ChildWrite
from app.services import children


def child_member(
    response: Response,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> Iterator[Member]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    children.require_active(member)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


router = APIRouter(prefix="/children", tags=["children"])
TenantMember = Annotated[Member, Depends(child_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=ChildListOut)
def list_children(member: TenantMember, db: DbSession):
    return children.list_children(db, member)


@router.post("", response_model=ChildOut, status_code=status.HTTP_201_CREATED)
def create_child(body: ChildWrite, member: TenantMember, db: DbSession):
    return children.create(db, member, body)


@router.get("/{child_id}", response_model=ChildDetailOut)
def get_child(child_id: uuid.UUID, member: TenantMember, db: DbSession):
    return children.get(db, member, child_id)


@router.patch("/{child_id}", response_model=ChildOut)
def update_child(child_id: uuid.UUID, body: ChildUpdate, member: TenantMember, db: DbSession):
    return children.update(db, member, child_id, body)
