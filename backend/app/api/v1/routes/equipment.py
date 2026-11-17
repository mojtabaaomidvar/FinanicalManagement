"""Online-only equipment with tenant and document-specific authorization context."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.core.errors import AppError
from app.db.document_scope import bind_member, clear_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.equipment import (
    EquipmentOut,
    EquipmentUpdate,
    EquipmentWrite,
    MaintenanceOut,
    MaintenanceResult,
    MaintenanceWrite,
)
from app.services import equipment


def equipment_member(
    response: Response,
    member: Annotated[Member, Depends(get_tenant_member)],
    db: Annotated[Session, Depends(get_db)],
) -> Iterator[Member]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    if member.status != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "حساب شما فعال نیست.", 403)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


router = APIRouter(prefix="/equipment", tags=["equipment"])
TenantMember = Annotated[Member, Depends(equipment_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[EquipmentOut])
def list_equipment(member: TenantMember, db: DbSession):
    return equipment.list_equipment(db, member)


@router.post("", response_model=EquipmentOut, status_code=status.HTTP_201_CREATED)
def create_equipment(body: EquipmentWrite, member: TenantMember, db: DbSession):
    return equipment.create(db, member, body)


@router.patch("/{equipment_id}", response_model=EquipmentOut)
def update_equipment(
    equipment_id: uuid.UUID, body: EquipmentUpdate, member: TenantMember, db: DbSession
):
    return equipment.update(db, member, equipment_id, body)


@router.delete("/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(
    equipment_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    equipment.remove(db, member, equipment_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


@router.get("/{equipment_id}/services", response_model=list[MaintenanceOut])
def list_services(equipment_id: uuid.UUID, member: TenantMember, db: DbSession):
    return equipment.list_services(db, member, equipment_id)


@router.post("/{equipment_id}/services", response_model=MaintenanceResult)
def add_service(
    equipment_id: uuid.UUID, body: MaintenanceWrite, member: TenantMember, db: DbSession
):
    return equipment.add_service(db, member, equipment_id, body)
