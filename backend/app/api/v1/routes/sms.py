"""روت پیام‌های بانکی و پل پیامک — خواندن (فاز ۶) + نوشتن (فاز ۷).

- GET  /sms?status=...     : فیلتر اختیاری وضعیت (pending/recorded/ignored).
- POST /sms                : درج دسته‌ای؛ شمارهٔ واردشده را برمی‌گرداند (عدد).
- PATCH /sms/{sms_id}      : تغییر وضعیت یک پیامک.
- GET  /sms/bridge         : پل فعال «عضو جاری» یا null (عضو-محور).
- POST /sms/bridge         : ساخت پل تازه؛ توکن آن را برمی‌گرداند (رشته).

تنظیمات تشخیص (رضایتِ به‌ازای هر حساب):
- PATCH  /sms/accounts/{account_id}/enabled :فعال/غیرفعال برای همان حساب.
- DELETE /sms/accounts/{account_id}         : بازنشانی تنظیمات همان حساب.
- GET    /sms/senders                       : فرستنده‌های مجاز خانواده.
- POST   /sms/accounts/{account_id}/senders : افزودن فرستنده به یک حساب.
- DELETE /sms/senders/{sender_id}           : حذف فرستنده.
- GET    /sms/numbers                       : شماره‌های «اضافه»ی عضو جاری.
- POST   /sms/numbers                       : افزودن شماره (تأییدنشده).
- PATCH  /sms/numbers/{number_id}           : خاموش/روشن‌کردن یک شماره.
- DELETE /sms/numbers/{number_id}           : حذف شماره.

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.core.errors import AppError
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import (
    AccountOut,
    BridgeOut,
    SmsBatch,
    SmsEnabledSet,
    SmsIngestBatch,
    SmsNumberCreate,
    SmsNumberOut,
    SmsNumberUpdate,
    SmsOut,
    SmsSenderCreate,
    SmsSenderOut,
    SmsStatusUpdate,
)
from app.services import messaging as messaging_service
from app.services import sms_settings as settings_service
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
    """درج پیامک‌های «خام» با پارس سمت‌سرور (خواندن نیتیو اپ + مسیر دستی آینده).

    برخلاف POST /sms (که فیلدهای پارس‌شدهٔ کلاینت را می‌گیرد و برای سازگاری در دورهٔ
    گذار می‌ماند)، اینجا فقط متن خام می‌آید و سرور پارس می‌کند تا همهٔ مسیرها یک‌جور
    باشند. ردیف‌های واردشده را برمی‌گرداند. تحت get_tenant_member و RLS.
    """
    rows = messaging_service.ingest_sms(
        db, member, [(it.raw_text, it.sender) for it in body.items]
    )
    return [SmsOut.of(r) for r in rows]


# ── تنظیمات تشخیص: رضایتِ به‌ازای هر حساب ───────────────────
# هیچ‌کدام از این روت‌ها حساب یا کارت نمی‌سازند؛ همه روی حسابِ «از پیش موجود»
# کار می‌کنند و اگر حساب نباشد NOT_FOUND می‌دهند.
@router.patch("/sms/accounts/{account_id}/enabled", response_model=AccountOut)
def set_account_sms_enabled(
    account_id: str,
    body: SmsEnabledSet,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> AccountOut:
    row = settings_service.set_enabled(
        db,
        member,
        to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404),
        body.enabled,
    )
    return AccountOut.of(row)


@router.delete("/sms/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def reset_account_sms(
    account_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    settings_service.reset_account(
        db, member, to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sms/senders", response_model=list[SmsSenderOut])
def list_sms_senders(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[SmsSenderOut]:
    return [
        SmsSenderOut.of(s) for s in settings_service.list_senders(db, member.family_id)
    ]


@router.post(
    "/sms/accounts/{account_id}/senders",
    response_model=SmsSenderOut,
    status_code=status.HTTP_201_CREATED,
)
def add_sms_sender(
    account_id: str,
    body: SmsSenderCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> SmsSenderOut:
    row = settings_service.add_sender(
        db,
        member,
        to_uuid(account_id, "NOT_FOUND", "حساب یافت نشد.", 404),
        body.sender,
    )
    return SmsSenderOut.of(row)


@router.delete("/sms/senders/{sender_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_sms_sender(
    sender_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    settings_service.remove_sender(
        db, member, to_uuid(sender_id, "NOT_FOUND", "فرستنده یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sms/numbers", response_model=list[SmsNumberOut])
def list_sms_numbers(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[SmsNumberOut]:
    """فقط شماره‌های «اضافه». شمارهٔ ثبت‌نام روی پروفایل عضو است."""
    return [SmsNumberOut.of(n) for n in settings_service.list_numbers(db, member.id)]


@router.post(
    "/sms/numbers", response_model=SmsNumberOut, status_code=status.HTTP_201_CREATED
)
def add_sms_number(
    body: SmsNumberCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> SmsNumberOut:
    row = settings_service.add_number(db, member, body.phone, body.label)
    return SmsNumberOut.of(row)


@router.patch("/sms/numbers/{number_id}", response_model=SmsNumberOut)
def set_sms_number_active(
    number_id: str,
    body: SmsNumberUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> SmsNumberOut:
    if body.active is None:
        raise AppError("INVALID_VALUE", "وضعیت شماره مشخص نیست.", 422)
    row = settings_service.set_number_active(
        db,
        member,
        to_uuid(number_id, "NOT_FOUND", "شماره یافت نشد.", 404),
        body.active,
    )
    return SmsNumberOut.of(row)


@router.delete("/sms/numbers/{number_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_sms_number(
    number_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    settings_service.remove_number(
        db, member, to_uuid(number_id, "NOT_FOUND", "شماره یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
