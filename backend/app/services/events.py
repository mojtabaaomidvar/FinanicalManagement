"""رویدادهای خانواده — خواندن (فاز ۶) + نوشتن با قواعد سمت سرور (فاز ۷).

خواندن — معادلِ list_events قدیمی: همهٔ ستون‌ها، مرتب بر date نزولی، سپس created_at نزولی.

نوشتن — معادلِ add_event، delete_event و sync_birthday_events قدیمی:
- add_event: عنوان ۱..۶۰، تاریخ الزامی، عضوِ سازنده (پیش‌فرض actor؛ انتساب به عضو
  دیگر فقط توسط مدیر)، for_member باید عضوِ «فعالِ» همین خانواده باشد، و اگر رویدادِ
  هم‌عنوان + هم‌تاریخ باشد → EVENT_DUPLICATE. ردیفِ ساخته‌شده را برمی‌گرداند.
- delete_event: مدیر هر رویدادِ خانواده؛ عضو فقط رویدادِ ساختهٔ خودش.
- sync_birthday_events: برای هر عضوِ فعالِ دارای تاریخِ تولد، رویدادِ «تولدِ ...» را
  به سالِ جاری هم‌گام می‌کند (به‌روزرسانیِ ردیفِ موجود یا ساختِ تازه)؛ شمارهٔ
  رویدادهای «تازه‌ساخته‌شده» را برمی‌گرداند (کلاینت این عدد را نادیده می‌گیرد).

کدهای تازه (خارج از RPC_ERROR_MAP فعلی، برای افزودن در فاز ۹): INVALID_EVENT.
مرزِ خانواده در لایهٔ اپ (فیلترِ family_id) در کنارِ RLS.
"""

from __future__ import annotations

import uuid
from datetime import date as _date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.event import FamilyEvent
from app.models.family import Member
from app.schemas.data import EventCreate
from app.services.common import to_uuid_opt


def list_for_family(db: Session, family_id: uuid.UUID) -> list[FamilyEvent]:
    return list(
        db.execute(
            select(FamilyEvent)
            .where(FamilyEvent.family_id == family_id)
            .order_by(FamilyEvent.date.desc(), FamilyEvent.created_at.desc())
        ).scalars()
    )


# ── نوشتن (فاز ۷) ────────────────────────────────────────────
def _birthday_title(name: str | None) -> str:
    return f"تولد {(name or '').strip()}".strip()


def _this_year_occurrence(birth: _date, today: _date) -> _date:
    """تاریخِ تولد در سالِ جاری (۲۹ اسفند/۲۹ فوریه → ۲۸)."""
    try:
        return birth.replace(year=today.year)
    except ValueError:
        return birth.replace(year=today.year, day=28)


def add_event(db: Session, actor: Member, req: EventCreate) -> FamilyEvent:
    title = (req.title or "").strip()
    if not title or len(title) > 60:
        raise AppError("INVALID_EVENT", "عنوان رویداد باید ۱ تا ۶۰ کاراکتر باشد.", 422)
    if req.date is None:
        raise AppError("INVALID_DATE", "تاریخِ رویداد لازم است.", 422)

    # سازندهٔ رویداد: پیش‌فرض خودِ actor؛ انتساب به عضو دیگر فقط توسط مدیر
    member_id = to_uuid_opt(req.member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if member_id is None:
        member_id = actor.id
    elif member_id != actor.id and actor.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر می‌تواند رویداد را به عضو دیگری نسبت دهد.", 403)
    if db.execute(
        select(Member.id).where(
            Member.id == member_id, Member.family_id == actor.family_id
        ).limit(1)
    ).first() is None:
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # عضوِ مرتبط (تولدِ چه کسی): در صورت وجود باید عضوِ «فعالِ» همین خانواده باشد
    for_member_id = to_uuid_opt(req.for_member_id, "INVALID_MEMBER", "عضو نامعتبر است.")
    if for_member_id is not None and db.execute(
        select(Member.id).where(
            Member.id == for_member_id,
            Member.family_id == actor.family_id,
            Member.status == "active",
        ).limit(1)
    ).first() is None:
        raise AppError("INVALID_MEMBER", "عضو نامعتبر است.", 422)

    # جلوگیری از رویدادِ تکراری (هم‌عنوان + هم‌تاریخ در همان خانواده)
    if db.execute(
        select(FamilyEvent.id).where(
            FamilyEvent.family_id == actor.family_id,
            FamilyEvent.title == title,
            FamilyEvent.date == req.date,
        ).limit(1)
    ).first() is not None:
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
    """حذف: مدیر هر رویدادِ خانواده؛ عضو فقط رویدادِ ساختهٔ خودش."""
    stmt = select(FamilyEvent).where(
        FamilyEvent.id == event_id, FamilyEvent.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(FamilyEvent.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "رویداد یافت نشد.", 404)
    db.delete(row)
    db.commit()


def sync_birthday_events(db: Session, actor: Member) -> int:
    """رویدادهای تولدِ اعضای فعال را با تاریخِ تولدِ پروفایل هم‌گام می‌کند.

    برای هر عضوِ فعالِ دارای birth_date: تاریخِ تولد در سالِ جاری محاسبه و ردیفِ
    «تولدِ ...»ی موجود (شناسایی با for_member_id + عنوانِ آغازشونده با «تولد»)
    به‌روزرسانی، وگرنه ردیفِ تازه ساخته می‌شود. شمارهٔ ردیف‌های تازه را برمی‌گرداند.
    """
    today = _date.today()
    members = list(
        db.execute(
            select(Member).where(
                Member.family_id == actor.family_id,
                Member.status == "active",
                Member.birth_date.is_not(None),
            )
        ).scalars()
    )
    created = 0
    for m in members:
        occ = _this_year_occurrence(m.birth_date, today)
        title = _birthday_title(m.name)
        existing = db.execute(
            select(FamilyEvent)
            .where(
                FamilyEvent.family_id == actor.family_id,
                FamilyEvent.for_member_id == m.id,
                FamilyEvent.title.like("تولد%"),
            )
            .order_by(FamilyEvent.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            existing.title = title
            existing.date = occ
        else:
            db.add(
                FamilyEvent(
                    family_id=actor.family_id,
                    member_id=actor.id,
                    for_member_id=m.id,
                    title=title,
                    date=occ,
                    note=None,
                )
            )
            created += 1
    db.commit()
    return created
