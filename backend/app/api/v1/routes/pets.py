"""Online pet profiles and canonical Task care use persistent member context."""

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
from app.schemas.pets import (
    PetCareOut,
    PetCareWrite,
    PetDetailOut,
    PetListOut,
    PetOut,
    PetUpdate,
    PetWrite,
)
from app.services import pets


def pet_member(
    response: Response,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> Iterator[Member]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    pets.require_active(member)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


router = APIRouter(prefix="/pets", tags=["pets"])
TenantMember = Annotated[Member, Depends(pet_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=PetListOut)
def list_pets(member: TenantMember, db: DbSession):
    return pets.list_pets(db, member)


@router.post("", response_model=PetOut, status_code=status.HTTP_201_CREATED)
def create_pet(body: PetWrite, member: TenantMember, db: DbSession):
    return pets.create(db, member, body)


@router.get("/{pet_id}", response_model=PetDetailOut)
def get_pet(pet_id: uuid.UUID, member: TenantMember, db: DbSession):
    return pets.get(db, member, pet_id)


@router.patch("/{pet_id}", response_model=PetOut)
def update_pet(pet_id: uuid.UUID, body: PetUpdate, member: TenantMember, db: DbSession):
    return pets.update(db, member, pet_id, body)


@router.delete("/{pet_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pet(
    pet_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    pets.remove(db, member, pet_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


@router.post("/{pet_id}/care-tasks", response_model=PetCareOut, status_code=status.HTTP_201_CREATED)
def create_care(pet_id: uuid.UUID, body: PetCareWrite, member: TenantMember, db: DbSession):
    return pets.create_care(db, member, pet_id, body)
