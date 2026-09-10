"""پیام‌های بانکی و پلِ پیامک — خواندن (فاز ۶) + نوشتن (فاز ۷).

خواندن:
- list_sms: همهٔ ستون‌ها، فیلترِ اختیاریِ status، مرتب بر created_at نزولی
  (معادلِ list_sms(p_token, p_status) قدیمی).
- get_bridge: پلِ «فعالِ» عضو جاری (آخرین ساخته‌شده) یا None. برخلافِ سایر خواندن‌ها
  این یک «عضو-محور» است (member_id)، نه صرفاً خانواده‌محور — عیناً مثلِ get_bridge
  قدیمی. RLS همچنان روی family_id اعمال است (پل‌های عضو در همان خانواده‌اند).

نوشتن — معادلِ add_sms_messages، set_sms_status و create_bridge قدیمی:
- add_sms_messages: درجِ دسته‌ای برای عضو جاری، شمارهٔ ردیف‌های واردشده را برمی‌گرداند
  (متنِ خالی نادیده؛ نوع فقط expense/income وگرنه NULL؛ status='pending').
- set_sms_status: تغییرِ وضعیت (pending/recorded/ignored)، NOT_FOUND اگر پیامک نباشد.
- create_bridge: غیرفعال‌کردنِ پل‌های فعالِ قبلیِ عضو و ساختِ توکنِ تازه (۴۰ هگز).

مرزِ خانواده در لایهٔ اپ (فیلترِ family_id) در کنارِ RLS.
"""

from __future__ import annotations

import secrets
import uuid

from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.rls import apply_to_transaction, reset_current_family, set_current_family
from app.models.family import Member
from app.models.messaging import SmsBridge, SmsMessage
from app.schemas.data import SmsItem
from app.services.sms_parser import detect_bank, normalize_sms, parse_sms

_SMS_STATUS = {"pending", "recorded", "ignored"}


def list_sms(
    db: Session, family_id: uuid.UUID, status: str | None = None
) -> list[SmsMessage]:
    stmt = select(SmsMessage).where(SmsMessage.family_id == family_id)
    if status is not None:
        stmt = stmt.where(SmsMessage.status == status)
    stmt = stmt.order_by(SmsMessage.created_at.desc())
    return list(db.execute(stmt).scalars())


def get_bridge(db: Session, member_id: uuid.UUID) -> SmsBridge | None:
    """پلِ فعالِ عضو جاری (آخرین)، یا None اگر پلی نساخته باشد."""
    return db.execute(
        select(SmsBridge)
        .where(SmsBridge.member_id == member_id, SmsBridge.active.is_(True))
        .order_by(SmsBridge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


# ── نوشتن (فاز ۷) ────────────────────────────────────────────
def add_sms_messages(db: Session, actor: Member, items: list[SmsItem]) -> int:
    """درجِ دسته‌ایِ پیام‌های بانکی برای عضو جاری؛ شمارهٔ ردیف‌های واردشده را برمی‌گرداند.

    پیام‌های با متنِ خالی نادیده گرفته می‌شوند؛ نوع فقط اگر expense/income باشد نگه
    داشته می‌شود (وگرنه NULL، هم‌سان با CHECKِ جدول)؛ وضعیت اولیه pending است.
    """
    rows: list[SmsMessage] = []
    for it in items:
        raw = (it.raw_text or "").strip()
        if not raw:
            continue
        stype = it.type if it.type in ("expense", "income") else None
        rows.append(
            SmsMessage(
                family_id=actor.family_id,
                member_id=actor.id,
                raw_text=raw,
                bank=(it.bank or "").strip() or None,
                type=stype,
                amount=it.amount,
                balance=it.balance,
                date=it.date,
                status="pending",
            )
        )
    if not rows:
        return 0
    db.add_all(rows)
    db.commit()
    return len(rows)


def set_sms_status(
    db: Session, actor: Member, sms_id: uuid.UUID, status: str | None
) -> None:
    st = (status or "").strip()
    if st not in _SMS_STATUS:
        raise AppError("INVALID_STATUS", "وضعیت پیامک نامعتبر است.", 422)
    row = db.execute(
        select(SmsMessage).where(
            SmsMessage.id == sms_id, SmsMessage.family_id == actor.family_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "پیامک یافت نشد.", 404)
    row.status = st
    db.commit()


def create_bridge(db: Session, actor: Member) -> str:
    """پل‌های فعالِ قبلیِ عضو را غیرفعال و پلِ تازه‌ای می‌سازد؛ توکنِ آن را برمی‌گرداند."""
    db.execute(
        sa_update(SmsBridge)
        .where(SmsBridge.member_id == actor.id, SmsBridge.active.is_(True))
        .values(active=False)
    )
    token = secrets.token_hex(20)  # ۴۰ رقمِ هگز — هم‌سان با create_bridge قدیمی
    db.add(
        SmsBridge(
            family_id=actor.family_id,
            member_id=actor.id,
            token=token,
            active=True,
        )
    )
    db.commit()
    return token


# ── ingest: پارس «سمت سرور» (فاز ۸) ──────────────────────────
# تفاوتِ کلیدی با add_sms_messages: آنجا کلاینت فیلدهای پارس‌شده را می‌فرستد؛ اینجا
# فقط متنِ خام می‌آید و سرور با app.services.sms_parser پارس می‌کند. هدف: وب و اندروید
# و پلِ فورواردر همگی «یک منطقِ پارس» داشته باشند (پیش‌تر فقط کلاینت پارس می‌کرد و
# مسیرها ناهم‌سان بودند).
def _row_from_raw(
    family_id: uuid.UUID,
    member_id: uuid.UUID | None,
    raw_text: str | None,
    sender: str | None,
) -> SmsMessage | None:
    """متنِ خام → ردیفِ SmsMessage (pending) با فیلدهای پارس‌شده؛ یا None اگر متن خالی.

    raw_text «اصل» (فقط trim‌شده) ذخیره می‌شود تا کاربر متنِ واقعی را ببیند؛ پارس روی
    نسخهٔ نرمال انجام می‌شود. اگر بانک از متن پیدا نشد و فرستنده داده شده بود، به‌عنوانِ
    کمکی از روی نامِ فرستنده هم تلاش می‌کنیم (بهبود نسبت به webhook قدیمی که نامِ
    فرستنده را خام در ستونِ bank می‌ریخت).
    """
    raw = (raw_text or "").strip()
    if not raw:
        return None
    parsed = parse_sms(raw)
    if parsed is None:
        return None
    bank = parsed.bank
    if bank is None and sender:
        bank = detect_bank(normalize_sms(sender))
    return SmsMessage(
        family_id=family_id,
        member_id=member_id,
        raw_text=raw,
        bank=bank,
        type=parsed.type,  # پارسر تضمین می‌کند expense/income/None
        amount=parsed.amount,
        balance=parsed.balance,
        date=parsed.date,
        status="pending",
    )


def ingest_sms(
    db: Session, actor: Member, items: list[tuple[str | None, str | None]]
) -> list[SmsMessage]:
    """درجِ دسته‌ایِ پیامک‌های «خام» برای عضو جاری با پارسِ سمت‌سرور.

    items فهرستی از (raw_text, sender) است. ردیف‌های واردشده را برمی‌گرداند (برای
    نمایشِ فوری در کلاینت، بدونِ نیاز به fetchِ دوباره). مسیرِ نشست‌محور (RLS فعال).
    """
    rows: list[SmsMessage] = []
    for raw_text, sender in items:
        row = _row_from_raw(actor.family_id, actor.id, raw_text, sender)
        if row is not None:
            rows.append(row)
    if not rows:
        return []
    db.add_all(rows)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def ingest_via_bridge(
    db: Session, token: str | None, text: str | None, sender: str | None = None
) -> int:
    """webhookِ پل (جایگزینِ api/sms-webhook.js): توکن → خانواده/عضو → پارس و درج.

    احراز با «توکنِ پل» است، نه نشستِ کاربر؛ پس این مسیر get_tenant_member ندارد و
    زمینهٔ RLS را «دستی» ست می‌کند. ابتدا ردیفِ پل با توکن خوانده می‌شود (جدولِ
    sms_bridges پس از مهاجرت 0003 بیرون از RLS است تا این خواندنِ پیش-از-زمینه ممکن
    باشد)، سپس زمینهٔ خانواده ست و پیامک در sms_messages (که هنوز زیرِ RLS است) درج
    می‌شود. تعدادِ واردشده (۰ یا ۱) را برمی‌گرداند.
    """
    tok = (token or "").strip()
    if not tok:
        raise AppError("UNAUTHORIZED", "توکن پل ارسال نشده است.", 401)
    bridge = db.execute(
        select(SmsBridge).where(SmsBridge.token == tok, SmsBridge.active.is_(True))
    ).scalar_one_or_none()
    if bridge is None:
        raise AppError("UNAUTHORIZED", "توکن پل نامعتبر است.", 401)

    ctx = set_current_family(bridge.family_id)
    try:
        apply_to_transaction(db)  # زمینهٔ خانواده روی همین تراکنشِ باز
        row = _row_from_raw(bridge.family_id, bridge.member_id, text, sender)
        if row is None:
            return 0
        db.add(row)
        db.commit()
        return 1
    finally:
        reset_current_family(ctx)
