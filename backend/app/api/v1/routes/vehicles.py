"""Online-only vehicles with protected member context across atomic commits."""

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
from app.schemas.vehicles import (
    VehicleListOut,
    VehicleOut,
    VehicleServiceOut,
    VehicleServiceResult,
    VehicleServiceWrite,
    VehicleUpdate,
    VehicleWrite,
)
from app.services import vehicles


def vehicle_member(
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


router = APIRouter(prefix="/vehicles", tags=["vehicles"])
TenantMember = Annotated[Member, Depends(vehicle_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=VehicleListOut)
def list_vehicles(member: TenantMember, db: DbSession):
    return vehicles.list_vehicles(db, member)


@router.post("", response_model=VehicleOut, status_code=status.HTTP_201_CREATED)
def create_vehicle(body: VehicleWrite, member: TenantMember, db: DbSession):
    return vehicles.create(db, member, body)


@router.patch("/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(vehicle_id: uuid.UUID, body: VehicleUpdate, member: TenantMember, db: DbSession):
    return vehicles.update(db, member, vehicle_id, body)


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    vehicles.remove(db, member, vehicle_id, base_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


@router.get("/{vehicle_id}/services", response_model=list[VehicleServiceOut])
def list_services(vehicle_id: uuid.UUID, member: TenantMember, db: DbSession):
    return vehicles.list_services(db, member, vehicle_id)


@router.post("/{vehicle_id}/services", response_model=VehicleServiceResult)
def add_service(
    vehicle_id: uuid.UUID, body: VehicleServiceWrite, member: TenantMember, db: DbSession
):
    return vehicles.add_service(db, member, vehicle_id, body)
