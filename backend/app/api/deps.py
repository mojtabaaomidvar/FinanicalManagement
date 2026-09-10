"""وابستگی‌های احراز هویت FastAPI.

اصل ثابت (تصمیم قفل‌شده): هویت عضو/خانواده «فقط» از توکن نشستِ سمت سرور در هدر
`Authorization: Bearer <token>` استخراج می‌شود؛ هرگز از بدنه یا کوئری کلاینت.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.rls import apply_to_transaction, reset_current_family, set_current_family
from app.db.session import get_db
from app.models.family import Member
from app.services import sessions


def get_bearer_token(authorization: str | None = Header(default=None, alias="Authorization")) -> str:
    """توکن خام را از هدر Bearer بیرون می‌کشد (بدون تماس با دیتابیس)."""
    if not authorization:
        raise AppError("UNAUTHORIZED", "توکن نشست ارسال نشده است.", 401)
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AppError("UNAUTHORIZED", "قالب هدر احراز هویت نادرست است.", 401)
    return parts[1].strip()


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
    return member


def require_owner(member: Member = Depends(get_current_member)) -> Member:
    """فقط مدیر خانواده مجاز است."""
    if member.role != "owner":
        raise AppError("FORBIDDEN", "فقط مدیر خانواده مجاز است.", 403)
    return member


@dataclass
class Principal:
    """عضو جاری + توکن خام (برای مسیرهایی که به توکنِ نشستِ جاری نیاز دارند)."""

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
    """عضو جاری + بستنِ «زمینهٔ خانواده» به تراکنش برای مسیرهای دادهٔ تحتِ RLS.

    مسیرهای فاز ۶/۷ (خواندن/نوشتنِ داده‌های خانواده‌محور) باید از این وابستگی استفاده
    کنند تا `app.family_id` روی تراکنش تنظیم شود و پالیسی‌های RLS ردیف‌ها را به همان
    خانواده محدود کنند. هویت همچنان فقط از توکن می‌آید (family_id از خودِ عضو، نه از
    بدنهٔ کلاینت). fail-closed: اگر این وابستگی به‌کار نرود، RLS صفر ردیف می‌دهد.
    """
    token = set_current_family(member.family_id)
    apply_to_transaction(db)  # پوششِ تراکنشی که پیش از ست‌شدن زمینه باز شده بود
    try:
        yield member
    finally:
        reset_current_family(token)
