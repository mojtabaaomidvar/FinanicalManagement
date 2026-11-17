"""رویدادهای خانواده — خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

خواندن — معادل list_events قدیمی: همهٔ ستون‌ها، مرتب بر date نزولی، سپس created_at نزولی.

نوشتن — معادل add_event، delete_event و sync_birthday_events قدیمی:
- add_event: عنوان ۱..۶۰، تاریخ الزامی، عضو سازنده (پیش‌فرض actor؛ انتساب به عضو
  دیگر فقط توسط مدیر)، for_member باید عضو «فعال» همین خانواده باشد، و اگر رویداد
  هم‌عنوان + هم‌تاریخ باشد → EVENT_DUPLICATE. ردیف ساخته‌شده را برمی‌گرداند.
- delete_event: مدیر هر رویداد خانواده؛ عضو فقط رویداد ساختهٔ خودش.
- sync_birthday_events: برای عضو واجد شرایط دارای تاریخ تولد، موعد بعدی «تولد ...»
  را با ماه و روز شمسی هم‌گام می‌کند (به‌روزرسانی همان ردیف یا ساخت جدید)؛
  شمارهٔ رویدادهای ساخته‌شده را برمی‌گرداند (کلاینت این عدد را نادیده می‌گیرد).

کدهای تازه (خارج از RPC_ERROR_MAP فعلی، برای افزودن در فاز ۹): INVALID_EVENT.
مرز خانواده در لایهٔ اپ (فیلتر family_id) در کنار RLS.
"""

from __future__ import annotations

import uuid
from datetime import date as _date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.document_scope import bind_member
from app.db.rls import bind_family_to_session
from app.models.event import FamilyEvent
from app.models.family import Member
from app.schemas.data import EventCreate
from app.services.birthday_dates import next_birthday_occurrence
from app.services.common import is_admin, to_uuid_opt
from app.services.member_age import today_tehran


def _event_sort_key(ev: FamilyEvent, today: _date) -> tuple[int, int, float]:
    """کلیدِ ترتیب: آینده اول (صعودی)، بعد گذشته (نزولی).

    در پایتون مرتب می‌شود نه در SQL — عمدی است. همان کار با `ORDER BY` و یک
    `CASE` شدنی بود، ولی این‌جا بی‌نیاز از دیتابیس قابلِ آزمون است و هیچ
    ریسکی از بابتِ تفاوتِ نسخهٔ SQLAlchemy ندارد. تعدادِ رویدادهای یک
    خانواده در حدِ ده‌هاست، پس هزینه‌اش صفر است.

    «امروز» جزوِ آینده است: رویدادِ امروز باید بالا باشد نه در گذشته.
    """
    future = ev.date >= today
    created = ev.created_at.timestamp() if ev.created_at else 0.0
    if future:
        return (0, ev.date.toordinal(), -created)
    # گذشته: نزولی → با منفی‌کردنِ ordinal، تازه‌ترین اول می‌آید
    return (1, -ev.date.toordinal(), -created)


def list_for_family(db: Session, family_id: uuid.UUID) -> list[FamilyEvent]:
    """رویدادها — **نزدیک‌ترینِ آینده اول**، بعد گذشته‌ها (تازه‌ترین اول).

    پیش از این `date DESC` بود، یعنی دورترین آیندهٔ ممکن اولِ فهرست می‌نشست
    و رویدادِ همین هفته جایی وسط لیست گم می‌شد. برای تقویم و برای کارتِ
    «رویدادهای مهم» هر دو، آن‌چه کاربر می‌خواهد «چه چیزی دارد می‌رسد» است.

    ترتیب این‌جا تعیین می‌شود نه در UI — تا صفحهٔ تقویم، کارتِ تنظیمات و
    هستهٔ اعلانِ §۷ یک فهرستِ یکسان ببینند (همان قاعدهٔ `services/bills.py`).
    """
    today = _date.today()
    rows = list(db.execute(select(FamilyEvent).where(FamilyEvent.family_id == family_id)).scalars())
    rows.sort(key=lambda ev: _event_sort_key(ev, today))
    return rows


# ── نوشتن (فاز ۷) ────────────────────────────────────────────
def _birthday_title(name: str | None) -> str:
    return f"تولد {(name or '').strip()}".strip()


def _this_year_occurrence(birth: _date, today: _date) -> _date:
    """Nearest inclusive birthday using the user's Jalali month and day."""
    return next_birthday_occurrence(birth, today)


def add_event(db: Session, actor: Member, req: EventCreate) -> FamilyEvent:
    title = (req.title or "").strip()
    if not title or len(title) > 60:
        raise AppError("INVALID_EVENT", "عنوان رویداد باید ۱ تا ۶۰ کاراکتر باشد.", 422)
    if req.date is None:
        raise AppError("INVALID_DATE", "تاریخ رویداد لازم است.", 422)

    # سازندهٔ رویداد: پیش‌فرض خود actor؛ انتساب به عضو دیگر فقط توسط مدیر
    member_id = to_uuid_opt(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if member_id is None:
        member_id = actor.id
    elif member_id != actor.id and not is_admin(actor):
        raise AppError("FORBIDDEN", "فقط مدیر می‌تواند رویداد را به عضو دیگری نسبت دهد.", 403)
    if (
        db.execute(
            select(Member.id)
            .where(Member.id == member_id, Member.family_id == actor.family_id)
            .limit(1)
        ).first()
        is None
    ):
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # عضو مرتبط (تولد چه کسی): در صورت وجود باید عضو «فعال» همین خانواده باشد
    for_member_id = to_uuid_opt(req.for_member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if (
        for_member_id is not None
        and db.execute(
            select(Member.id)
            .where(
                Member.id == for_member_id,
                Member.family_id == actor.family_id,
                Member.status == "active",
            )
            .limit(1)
        ).first()
        is None
    ):
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # جلوگیری از رویداد تکراری (هم‌عنوان + هم‌تاریخ در همان خانواده)
    if (
        db.execute(
            select(FamilyEvent.id)
            .where(
                FamilyEvent.family_id == actor.family_id,
                FamilyEvent.kind == "event",
                FamilyEvent.title == title,
                FamilyEvent.date == req.date,
            )
            .limit(1)
        ).first()
        is not None
    ):
        raise AppError("EVENT_DUPLICATE", "این رویداد قبلاً ثبت شده است.", 409)

    row = FamilyEvent(
        family_id=actor.family_id,
        member_id=member_id,
        for_member_id=for_member_id,
        title=title,
        date=req.date,
        note=(req.note or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_event(db: Session, actor: Member, event_id: uuid.UUID) -> None:
    """حذف: مدیر هر رویداد خانواده؛ عضو فقط رویداد ساختهٔ خودش."""
    stmt = select(FamilyEvent).where(
        FamilyEvent.id == event_id, FamilyEvent.family_id == actor.family_id
    )
    if not is_admin(actor):
        stmt = stmt.where(FamilyEvent.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "رویداد یافت نشد.", 404)
    if row.kind == "activity":
        raise AppError(
            "ACTIVITY_ROUTE_REQUIRED",
            "این برنامه را از بخش تفریح و برنامه‌های خانوادگی مدیریت کنید.",
            409,
        )
    db.delete(row)
    db.commit()


def reconcile_member_birthday(
    db: Session, actor: Member, member: Member, *, today: _date | None = None
) -> bool:
    """Reconcile one canonical birthday atomically with its member; never commits."""
    if member.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    bind_family_to_session(db, actor.family_id)
    bind_member(db, actor.id)
    # SessionLocal has autoflush=False; compound event FKs require the saved member.
    db.flush([member])
    db.flush()  # A second reconciliation in the same unit of work sees staged birthdays.
    locked_member = db.scalar(
        select(Member)
        .where(Member.id == member.id, Member.family_id == actor.family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_member is None:
        return False
    member = locked_member
    rows = list(
        db.scalars(
            select(FamilyEvent)
            .where(
                FamilyEvent.family_id == actor.family_id,
                FamilyEvent.kind == "event",
                FamilyEvent.for_member_id == member.id,
                FamilyEvent.title.like("تولد%"),
            )
            .order_by(FamilyEvent.created_at, FamilyEvent.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    current_day = today or today_tehran()
    eligible = member.membership_state == "active" and (
        member.status == "active" or (member.status == "pending" and member.relation == "فرزند")
    )
    occurrence = None
    if eligible and member.birth_date is not None and member.birth_date <= current_day:
        try:
            occurrence = next_birthday_occurrence(member.birth_date, current_day)
        except (ValueError, OverflowError):
            # Legacy dates outside the supported Jalali range cannot create birthdays.
            occurrence = None
    if occurrence is None:
        for row in rows:
            db.delete(row)
        return False
    if rows:
        existing = rows[0]
        existing.title = _birthday_title(member.name)
        existing.date = occurrence
        for duplicate in rows[1:]:
            db.delete(duplicate)
        return False
    db.add(
        FamilyEvent(
            family_id=actor.family_id,
            member_id=actor.id,
            for_member_id=member.id,
            title=_birthday_title(member.name),
            date=occurrence,
            note=None,
        )
    )
    return True


def clear_member_birthday(db: Session, actor: Member, member: Member) -> None:
    """Physical member removal drops only its generated/legacy birthday rows."""
    if member.family_id != actor.family_id:
        raise AppError("NOT_FOUND", "عضو یافت نشد.", 404)
    bind_family_to_session(db, actor.family_id)
    bind_member(db, actor.id)
    locked_member = db.scalar(
        select(Member)
        .where(Member.id == member.id, Member.family_id == actor.family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_member is None:
        return
    rows = db.scalars(
        select(FamilyEvent).where(
            FamilyEvent.family_id == actor.family_id,
            FamilyEvent.kind == "event",
            FamilyEvent.for_member_id == member.id,
            FamilyEvent.title.like("تولد%"),
        )
    )
    for row in rows:
        db.delete(row)


def sync_birthday_events(db: Session, actor: Member) -> int:
    """Keep one next Jalali birthday per eligible member and remove stale birthdays."""
    members = list(
        db.execute(
            select(Member)
            .where(
                Member.family_id == actor.family_id,
            )
            .order_by(Member.id)
        ).scalars()
    )
    created = 0
    current_day = today_tehran()
    for m in members:
        created += int(reconcile_member_birthday(db, actor, m, today=current_day))
    db.commit()
    return created
