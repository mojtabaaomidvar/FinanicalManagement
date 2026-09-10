"""روتِ رویدادهای خانواده — خواندن (فاز ۶) + نوشتن (فاز ۷).

- GET    /events                : فهرستِ رویدادهای خانواده.
- POST   /events                : ساختِ رویداد؛ ردیفِ ساخته‌شده را برمی‌گرداند (۲۰۱).
- DELETE /events/{event_id}     : حذفِ رویداد (مدیر هر رویداد / عضو فقط ساختهٔ خودش).
- POST   /events/sync-birthdays : هم‌گام‌سازیِ رویدادهای تولد؛ شمارهٔ رویدادِ تازه (عدد).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import EventCreate, EventOut
from app.services import events as event_service
from app.services.common import to_uuid

router = APIRouter(tags=["events"])


@router.get("/events", response_model=list[EventOut])
def list_events(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    return [EventOut.of(e) for e in event_service.list_for_family(db, member.family_id)]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def add_event(
    body: EventCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> EventOut:
    return EventOut.of(event_service.add_event(db, member, body))


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    event_service.delete_event(
        db, member, to_uuid(event_id, "NOT_FOUND", "رویداد یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/events/sync-birthdays", response_model=int)
def sync_birthday_events(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> int:
    return event_service.sync_birthday_events(db, member)
