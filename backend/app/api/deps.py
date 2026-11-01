"""وابستگی‌های احراز هویت FastAPI.

اصل ثابت (تصمیم قفل‌شده): هویت عضو/خانواده «فقط» از توکن نشست سمت سرور در هدر
`Authorization: Bearer <token>` استخراج می‌شود؛ هرگز از بدنه یا کوئری کلاینت.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.rls import (
    apply_to_transaction,
    bind_family_to_session,
    clear_family_from_session,
    reset_current_family,
    set_current_family,
)
from app.db.session import get_db
from app.models.family import Member
from app.services import sessions
from app.services.common import is_admin


def get_bearer_token(authorization: str | None = Header(default=None, alias="Authorization")) -> str:
    """توکن خام را از هدر Bearer بیرون می‌کشد (بدون تماس با دیتابیس)."""
    if not authorization:
        raise AppError("UNAUTHORIZED", "توکن نشست ارسال نشده است.", 401)
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AppError("UNAUTHORIZED", "قالب هدر احراز هویت نادرست است.", 401)
    return parts[1].strip()


def _require_active_membership(member: Member) -> None:
    """گیتِ واحد: فقط عضوِ ACTIVE به مسیرهای احرازشده راه دارد (§2.5/§2.6).

    اعضای pending اصلاً نشست نمی‌گیرند؛ این گیت جلوی نشستِ عضوی را می‌گیرد که پس از
    ورود suspended/removed/rejected شده (دفاع در عمق، مستقل از پاک‌سازیِ نشست).
    """
    if member.membership_state != "active":
        raise AppError("MEMBERSHIP_INACTIVE", "عضویت شما در خانواده فعال نیست.", 403)


def get_current_member(
    token: str = Depends(get_bearer_token),
    db: Session = Depends(get_db),
) -> Member:
    """توکن → عضو جاری. نشست را تازه می‌کند؛ در صورت نامعتبری SESSION_EXPIRED."""
    member_id = sessions.resolve_member_id(db, token)
    member = db.get(Member, member_id)
    if member is None:
        # نشست به عضوی اشاره دارد که دیگر نیست
        raise AppError("SESSION_EXPIRED", "نشست نامعتبر یا منقضی است.", 401)
    _require_active_membership(member)
    return member


def require_admin(member: Member = Depends(get_current_member)) -> Member:
    """فقط مدیر خانواده مجاز است (owner یا admin)."""
    if not is_admin(member):
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    return member


@dataclass
class Principal:
    """عضو جاری + توکن خام (برای مسیرهایی که به توکن نشست جاری نیاز دارند)."""

    member: Member
    raw_token: str


def get_principal(
    token: str = Depends(get_bearer_token),
    db: Session = Depends(get_db),
) -> Principal:
    member_id = sessions.resolve_member_id(db, token)
    member = db.get(Member, member_id)
    if member is None:
        raise AppError("SESSION_EXPIRED", "نشست نامعتبر یا منقضی است.", 401)
    return Principal(member=member, raw_token=token)


def get_tenant_member(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> Iterator[Member]:
    """عضو جاری + بستن «زمینهٔ خانواده» به تراکنش برای مسیرهای دادهٔ تحت RLS.

    مسیرهای فاز ۶/۷ (خواندن/نوشتن داده‌های خانواده‌محور) باید از این وابستگی استفاده
    کنند تا `app.family_id` روی تراکنش تنظیم شود و پالیسی‌های RLS ردیف‌ها را به همان
    خانواده محدود کنند. هویت همچنان فقط از توکن می‌آید (family_id از خود عضو، نه از
    بدنهٔ کلاینت). fail-closed: اگر این وابستگی به‌کار نرود، RLS صفر ردیف می‌دهد.
    """
    token = set_current_family(member.family_id)
    bind_family_to_session(db, member.family_id)  # منبعِ اصلیِ زمینه، پایدار پس از commit (#۶)
    apply_to_transaction(db)  # پوشش تراکنشی که پیش از ست‌شدن زمینه باز شده بود
    try:
        yield member
    finally:
        clear_family_from_session(db)
        reset_current_family(token)


def require_admin_tenant(
    member: Member = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Iterator[Member]:
    """مدیرِ خانواده + بستن زمینهٔ RLS — برای مسیرهایی که به جدولِ RLSدارِ
    join_requests دست می‌زنند (فهرست/تأیید/رد). ترکیبِ require_admin و get_tenant_member.
    """
    token = set_current_family(member.family_id)
    bind_family_to_session(db, member.family_id)
    apply_to_transaction(db)
    try:
        yield member
    finally:
        clear_family_from_session(db)
        reset_current_family(token)
