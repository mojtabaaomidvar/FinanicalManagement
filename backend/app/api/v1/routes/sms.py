"""روتِ پیام‌های بانکی و پلِ پیامک — خواندن (فاز ۶) + نوشتن (فاز ۷).

- GET  /sms?status=...     : فیلترِ اختیاریِ وضعیت (pending/recorded/ignored).
- POST /sms                : درجِ دسته‌ای؛ شمارهٔ واردشده را برمی‌گرداند (عدد).
- PATCH /sms/{sms_id}      : تغییرِ وضعیت یک پیامک.
- GET  /sms/bridge         : پلِ فعالِ «عضو جاری» یا null (عضو-محور).
- POST /sms/bridge         : ساختِ پلِ تازه؛ توکنِ آن را برمی‌گرداند (رشته).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.core.errors import AppError
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import BridgeOut, SmsBatch, SmsIngestBatch, SmsOut, SmsStatusUpdate
from app.services import messaging as messaging_service
from app.services.common import to_uuid

router = APIRouter(tags=["sms"])

_ALLOWED_STATUS = {"pending", "recorded", "ignored"}


@router.get("/sms", response_model=list[SmsOut])
def list_sms(
    status: str | None = Query(default=None),
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[SmsOut]:
    if status is not None and status not in _ALLOWED_STATUS:
        raise AppError("INVALID_STATUS", "وضعیت پیامک نامعتبر است.", 422)
    return [
        SmsOut.of(s)
        for s in messaging_service.list_sms(db, member.family_id, status)
    ]


@router.post("/sms", response_model=int)
def add_sms_messages(
    body: SmsBatch,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> int:
    return messaging_service.add_sms_messages(db, member, body.items)


@router.patch("/sms/{sms_id}", status_code=status.HTTP_204_NO_CONTENT)
def set_sms_status(
    sms_id: str,
    body: SmsStatusUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    messaging_service.set_sms_status(
        db, member, to_uuid(sms_id, "NOT_FOUND", "پیامک یافت نشد.", 404), body.status
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sms/bridge", response_model=BridgeOut | None)
def get_bridge(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> BridgeOut | None:
    bridge = messaging_service.get_bridge(db, member.id)
    return BridgeOut.of(bridge) if bridge is not None else None


@router.post("/sms/bridge", response_model=str, status_code=status.HTTP_201_CREATED)
def create_bridge(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> str:
    return messaging_service.create_bridge(db, member)


@router.post(
    "/sms/ingest",
    response_model=list[SmsOut],
    status_code=status.HTTP_201_CREATED,
)
def ingest_sms_messages(
    body: SmsIngestBatch,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[SmsOut]:
    """درجِ پیامک‌های «خام» با پارسِ سمت‌سرور (خواندنِ نیتیوِ اپ + مسیرِ دستیِ آینده).

    برخلافِ POST /sms (که فیلدهای پارس‌شدهٔ کلاینت را می‌گیرد و برای سازگاری در دورهٔ
    گذار می‌ماند)، اینجا فقط متنِ خام می‌آید و سرور پارس می‌کند تا همهٔ مسیرها یک‌جور
    باشند. ردیف‌های واردشده را برمی‌گرداند. تحتِ get_tenant_member و RLS.
    """
    rows = messaging_service.ingest_sms(
        db, member, [(it.raw_text, it.sender) for it in body.items]
    )
    return [SmsOut.of(r) for r in rows]
