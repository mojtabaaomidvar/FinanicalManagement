"""Shared family tasks: every route establishes the tenant's RLS context."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.tasks import TaskComplete, TaskOut, TaskUpdate, TaskWrite
from app.services import tasks

router = APIRouter(tags=["tasks"])
TenantMember = Annotated[Member, Depends(get_tenant_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(member: TenantMember, db: DbSession):
    return tasks.list_for_family(db, member)


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskWrite, member: TenantMember, db: DbSession):
    return tasks.create(db, member, body)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    member: TenantMember,
    db: DbSession,
):
    return tasks.change(
        db,
        member,
        task_id,
        body.base_revision,
        "update",
        body.model_dump(exclude={"base_revision"}),
    )


@router.post("/tasks/{task_id}/complete", response_model=TaskOut)
def complete_task(
    task_id: uuid.UUID,
    body: TaskComplete,
    member: TenantMember,
    db: DbSession,
):
    return tasks.change(
        db,
        member,
        task_id,
        body.base_revision,
        "complete",
        body.model_dump(exclude={"base_revision"}),
    )


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: TenantMember,
    db: DbSession,
):
    tasks.change(db, member, task_id, base_revision, "delete", {})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
