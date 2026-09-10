"""روتِ تنظیماتِ خانواده و پروفایلِ عضو — نوشتن (فاز ۷).

این روت‌ها روی جدول‌های «هویتیِ» families/members کار می‌کنند که از RLS مستثنا
هستند؛ بنابراین برخلافِ روت‌های داده، از get_tenant_member استفاده نمی‌کنند:
- get_current_member: هویتِ عضو از توکن (بدون بستنِ زمینهٔ RLS).
- require_owner: فقط مدیر (برای سقفِ بودجهٔ خانواده).
مرزِ مستأجر در «لایهٔ اپ» اعمال می‌شود (سرویس، family_id عضو را می‌سنجد).

- PATCH /family/settings            : سقفِ بودجهٔ خانواده (فقط مدیر) → ۲۰۴.
- PATCH /members/me                 : پروفایلِ خودِ عضو → MemberPublic.
- PATCH /members/me/theme           : تمِ نمایشِ خودِ عضو → ۲۰۴.
- PATCH /members/me/currency        : واحدِ پولِ خودِ عضو → MemberPublic.
- PATCH /members/{member_id}/relation : نسبتِ یک عضو → MemberPublic.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, require_owner
from app.db.session import get_db
from app.models.family import Member
from app.schemas.auth import MemberPublic
from app.schemas.data import (
    CurrencyUpdate,
    FamilySettingsUpdate,
    MemberProfileUpdate,
    RelationUpdate,
    ThemeUpdate,
)
from app.services import family as family_service
from app.services.common import to_uuid

router = APIRouter(tags=["members"])


@router.patch("/family/settings", status_code=status.HTTP_204_NO_CONTENT)
def update_family_settings(
    body: FamilySettingsUpdate,
    owner: Member = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    family_service.update_family_settings(db, owner, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/members/me", response_model=MemberPublic)
def update_member_profile(
    body: MemberProfileUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> MemberPublic:
    return MemberPublic.of(family_service.update_member_profile(db, member, body))


@router.patch("/members/me/theme", status_code=status.HTTP_204_NO_CONTENT)
def set_member_theme(
    body: ThemeUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> Response:
    family_service.set_member_theme(db, member, body.theme)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/members/me/currency", response_model=MemberPublic)
def set_member_currency(
    body: CurrencyUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> MemberPublic:
    return MemberPublic.of(family_service.set_member_currency(db, member, body.currency))


@router.patch("/members/{member_id}/relation", response_model=MemberPublic)
def set_member_relation(
    member_id: str,
    body: RelationUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> MemberPublic:
    return MemberPublic.of(
        family_service.set_member_relation(
            db, member, to_uuid(member_id, "NOT_FOUND", "عضو یافت نشد.", 404), body.relation
        )
    )
