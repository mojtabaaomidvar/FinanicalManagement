"""روت §۷ اعلان‌ها — ترجیحات و «نادیده گرفتم».

اعلان خودش اندپوینت ندارد: مشتق‌شده است و کلاینت از دادهٔ موجود می‌سازدش
(یادداشتِ تاریخ‌دارِ زیرِ §7.1 در `docs/master-prompt.md`). این‌جا فقط دو چیزِ
ماندگار سرو می‌شود.

⚠️ **هر چهار مسیر `get_tenant_member` می‌گیرند — و این درس‌خوردهٔ یک اشتباه
است.** نسخهٔ اول دو مسیرِ `prefs` را `get_current_member` داده بود، با این
استدلال که «ترجیحات ستونِ `members` است و آن جدول از RLS مستثناست». استدلال
درست بود ولی **معیار را اشتباه گرفته بود**: مهم این نیست مفهوم در کدام جدول
زندگی می‌کند، مهم این است که آن *درخواست* به چه جدول‌هایی دست می‌زند. پاسخِ
`prefs` فهرستِ نادیده‌گرفته‌ها را هم در خود دارد و آن جدول زیرِ RLS +
FORCE است؛ پس بی‌بستنِ `app.family_id` محمولِ fail-closed **صفر ردیف**
می‌داد و `dismissed` همیشه خالی برمی‌گشت — بی هیچ خطایی. دقیقاً همان چیزی که
docstringِ `get_tenant_member` هشدار می‌دهد.

قاعده برای مسیرهای تازه: اگر درخواست **حتی یک** جدولِ RLSدار را بخواند یا
بنویسد، `get_tenant_member` می‌خواهد. `get_current_member` فقط برای
درخواست‌هایی است که تماماً روی `families`/`members` کار می‌کنند.

- GET    /notifications/prefs              : ترجیحات + فهرستِ نادیده‌گرفته‌ها.
- PATCH  /notifications/prefs              : به‌روزرسانیِ جزئی.
- POST   /notifications/dismissals         : ثبتِ نادیده‌گرفتن (idempotent) → ۲۰۴.
- DELETE /notifications/dismissals/{key}   : برگرداندن → ۲۰۴.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import (
    DismissalCreate,
    NotificationPrefsOut,
    NotificationPrefsUpdate,
)
from app.services import notifications as notif_service

router = APIRouter(tags=["notifications"])


@router.get("/notifications/prefs", response_model=NotificationPrefsOut)
def get_notification_prefs(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> NotificationPrefsOut:
    return notif_service.get_prefs(db, member)


@router.patch("/notifications/prefs", response_model=NotificationPrefsOut)
def update_notification_prefs(
    body: NotificationPrefsUpdate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> NotificationPrefsOut:
    return notif_service.update_prefs(db, member, body)


@router.post("/notifications/dismissals", status_code=status.HTTP_204_NO_CONTENT)
def add_dismissal(
    body: DismissalCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    notif_service.dismiss(db, member, body.key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/notifications/dismissals/{key:path}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_dismissal(
    key: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    """`{key:path}` لازم است: شناسهٔ اعلان خودش «:» دارد
    (`event:<uuid>:<date>`) و مسیرِ معمولی آن را نمی‌پذیرد."""
    notif_service.undismiss(db, member, key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
