"""قرارداد ورودی/خروجی احراز هویت (Pydantic v2).

قواعد کلیدی:
- توکن نشست هرگز در بدنهٔ درخواست نمی‌آید؛ فقط از هدر `Authorization: Bearer` خوانده
  می‌شود (وابستگی get_current_member). این فایل عمداً هیچ فیلد `token` در بدنه ندارد.
- حداقل طول رمز (۸) فقط هنگام «تعیین» رمز اعمال می‌شود (ثبت‌نام، پذیرش دعوت،
  تغییر رمز)، نه هنگام ورود — کاربران فعلی با رمز کوتاه نباید از حساب خود بیرون بمانند.
- password_hash و هر رازی هرگز در پاسخ نمی‌آید؛ MemberPublic صراحتاً فیلدها را می‌سازد.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_serializer

if TYPE_CHECKING:  # فقط برای تایپ؛ وابستگی زمان‌اجرا به مدل‌ها ایجاد نمی‌کند
    from app.models.family import Family, Member

PHONE_PATTERN = r"^09\d{9}$"
_MIN_PASSWORD = 8


# ── نماهای خروجی ─────────────────────────────────────────────
class MemberPublic(BaseModel):
    """نمای امنِ عضو — معادل _member_public در schema.sql (بدون password_hash)."""

    id: str
    family_id: str
    name: str
    role: str
    phone: str | None
    gender: str | None
    birth_date: str | None  # قالب 'YYYY-MM-DD'
    # national_id حذف شد (درخواست مالک ۲۰۲۶-۰۹-۰۸): کدملی دیگر در هیچ پاسخی برنمی‌گردد.
    avatar_url: str | None
    status: str
    theme: str
    relation: str
    currency: str
    created_at: datetime

    @classmethod
    def of(cls, m: Member) -> MemberPublic:
        return cls(
            id=str(m.id),
            family_id=str(m.family_id),
            name=m.name,
            role=m.role,
            phone=m.phone,
            gender=m.gender,
            birth_date=m.birth_date.isoformat() if isinstance(m.birth_date, date) else None,
            avatar_url=m.avatar_url,
            status=m.status,
            theme=m.theme,
            relation=m.relation,
            currency=m.currency,
            created_at=m.created_at,
        )


class FamilyOut(BaseModel):
    """خانواده — همهٔ ستون‌های عمومی (معادل to_jsonb(family))."""

    id: str
    name: str
    code: str
    budget: Decimal
    currency: str
    dark: bool
    created_at: datetime

    @field_serializer("budget")
    def _ser_budget(self, v: Decimal) -> float:
        # مبلغ به‌صورت عدد سریال می‌شود تا با انتظار فعلی کلاینت سازگار بماند.
        return float(v)

    @classmethod
    def of(cls, f: Family) -> FamilyOut:
        return cls(
            id=str(f.id),
            name=f.name,
            code=f.code,
            budget=f.budget,
            currency=f.currency,
            dark=f.dark,
            created_at=f.created_at,
        )


class AuthResult(BaseModel):
    """خروجی ورود/ثبت‌نام/پذیرش دعوت: عضو + خانواده + توکن نشست (فقط یک‌بار)."""

    member: MemberPublic
    family: FamilyOut
    session_token: str


class SessionPayload(BaseModel):
    """خروجی اعتبارسنجی نشست: عضو جاری + خانواده + همهٔ اعضا (برای ورود به اپ)."""

    member: MemberPublic
    family: FamilyOut
    members: list[MemberPublic]


class PublicConfig(BaseModel):
    otp_enabled: bool


class OkResult(BaseModel):
    ok: bool


class PreRegisteredResult(BaseModel):
    pre_registered: bool
    family_name: str | None = None


class InviteInfo(BaseModel):
    family_name: str


class InviteToken(BaseModel):
    token: str


# ── بدنه‌های ورودی ───────────────────────────────────────────
class LoginRequest(BaseModel):
    # عمداً str_strip_whitespace نداریم: رمز نباید بی‌صدا trim شود.
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=1)  # روی ورود حداقل طول اعمال نمی‌شود
    code: str | None = None  # کد OTP — فقط وقتی OTP فعال است لازم است


class CheckPasswordRequest(BaseModel):
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=1)


class OtpRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    phone: str = Field(pattern=PHONE_PATTERN)


class PreRegisteredRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    phone: str = Field(pattern=PHONE_PATTERN)


class RegisterRequest(BaseModel):
    # رمز trim نمی‌شود؛ نام‌ها/نسبت در لایهٔ سرویس strip می‌شوند.
    family_name: str = Field(min_length=1, max_length=60)
    member_name: str = Field(min_length=1, max_length=40)
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=_MIN_PASSWORD)  # تعیین رمز → حداقل ۸
    otp_code: str | None = None
    relation: str = Field(default="خودم", min_length=1)


class AcceptInviteRequest(BaseModel):
    # رمز trim نمی‌شود؛ نام‌ها/نسبت در لایهٔ سرویس strip می‌شوند.
    invite_token: str = Field(min_length=1)
    member_name: str = Field(min_length=1, max_length=40)
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=_MIN_PASSWORD)  # تعیین رمز → حداقل ۸
    otp_code: str | None = None
    relation: str = Field(default="سایر", min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=_MIN_PASSWORD)  # تعیین رمز → حداقل ۸


class AddMemberRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=40)
    phone: str = Field(pattern=PHONE_PATTERN)
    relation: str = Field(default="سایر", min_length=1)
