"""روتِ webhookِ ماشین-به-ماشین — ingestِ پیامک با «توکنِ پل» (فاز ۸).

جایگزینِ api/sms-webhook.js (تابعِ سرورلسِ Vercel). این تنها روتی است که با نشستِ
کاربر (Bearer) احراز نمی‌شود؛ احراز با «توکنِ پلِ» ۴۰-هگز در بدنه است — یک قراردادِ
ماشین-به-ماشین برای اپِ فورواردر (فالبکِ وب/iOS). به همین دلیل این روت عمداً در
فایلی جدا از روت‌های دادهٔ نشست‌محور (sms.py) قرار دارد تا مرزِ «هویت فقط از Bearer»
در آن فایل‌ها دست‌نخورده بماند.

زمینهٔ RLS: چون get_tenant_member نداریم، سرویسِ ingest_via_bridge خودش پس از یافتنِ
پل با توکن، زمینهٔ خانواده را دستی ست می‌کند (جزئیات در services/messaging.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.data import BridgeIngest, IngestResult
from app.services import messaging as messaging_service

router = APIRouter(tags=["webhooks"])


@router.post("/sms/bridge-ingest", response_model=IngestResult)
def bridge_ingest(
    body: BridgeIngest,
    db: Session = Depends(get_db),
) -> IngestResult:
    """webhookِ پل: {token, text, sender?} → پارسِ سمت‌سرور → درجِ pending.

    توکنِ نامعتبر → UNAUTHORIZED (۴۰۱). متنِ خالی → count=0 بدونِ خطا.
    """
    n = messaging_service.ingest_via_bridge(db, body.token, body.text, body.sender)
    return IngestResult(ok=True, count=n)
