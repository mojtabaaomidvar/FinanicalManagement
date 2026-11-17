"""روت رویدادهای خانواده — خواندن (فاز ۶) + نوشتن (فاز ۷).

- GET    /events                : فهرست رویدادهای خانواده.
- POST   /events                : ساخت رویداد؛ ردیف ساخته‌شده را برمی‌گرداند (۲۰۱).
- DELETE /events/{event_id}     : حذف رویداد (مدیر هر رویداد / عضو فقط ساختهٔ خودش).
- POST   /events/sync-birthdays : هم‌گام‌سازی رویدادهای تولد؛ شمارهٔ رویداد تازه (عدد).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.core.errors import AppError
from app.db.document_scope import bind_member, clear_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import EventCreate, EventOut
from app.services import events as event_service
from app.services.common import to_uuid

router = APIRouter(tags=["events"])


def event_member(
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


TenantMember = Annotated[Member, Depends(event_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/events", response_model=list[EventOut])
def list_events(
    member: TenantMember,
    db: DbSession,
) -> list[EventOut]:
    return [EventOut.of(e) for e in event_service.list_for_family(db, member.family_id)]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def add_event(
    body: EventCreate,
    member: TenantMember,
    db: DbSession,
) -> EventOut:
    return EventOut.of(event_service.add_event(db, member, body))


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: str,
    member: TenantMember,
    db: DbSession,
) -> Response:
    event_service.delete_event(db, member, to_uuid(event_id, "NOT_FOUND", "رویداد یافت نشد.", 404))
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


@router.post("/events/sync-birthdays", response_model=int)
def sync_birthday_events(
    member: TenantMember,
    db: DbSession,
) -> int:
    return event_service.sync_birthday_events(db, member)
