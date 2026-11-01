"""نشست‌ها، کد یک‌بارمصرف، تلاش‌های ورود، و دعوت خانواده.

نکتهٔ امنیتی (رفع D-3): ستون sessions.token اکنون «هش» توکن (SHA-256 هگز)
را نگه می‌دارد، نه خود توکن خام. توکن خام فقط یک‌بار به کلاینت داده می‌شود.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# هدفِ کدِ یک‌بارمصرف. مقدارِ رشته‌ای و نه Enumِ پستگرس، تا افزودنِ هدفِ تازه
# مهاجرتِ ساختاری نخواهد. `login` پیش‌فرضِ ستون است (سازگاریِ عقب‌رو).
PURPOSE_LOGIN = "login"
PURPOSE_RESET = "password_reset"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # هش SHA-256 توکن نشست (۶۴ هگز)؛ توکن خام ذخیره نمی‌شود.
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # سقف مطلق (۹۰ روز از ایجاد) در این ستون؛ لغزش ۷روزه با last_seen_at محاسبه می‌شود.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class OtpCode(Base):
    """کدِ یک‌بارمصرف — **هش‌شده** و **هدف‌دار**.

    دو تغییرِ ۲۰۲۶-۰۹-۲۷ (مهاجرتِ `0008`)، هر دو رفعِ نقصِ موجود:

    * `code_hash` جای `code`ِ خام را گرفت. کدِ یک‌بارمصرف عملاً یک اعتبارنامه
      است و §۵.۱۱ ذخیرهٔ برگشت‌پذیرِ اعتبارنامه را منع می‌کند. مقدار،
      HMAC-SHA256ِ فلفل‌خوردهٔ کد است (`services/otp.py`).
    * `purpose` اضافه شد. بی‌آن، کدی که برای «ورود» فرستاده شده بود می‌توانست
      برای «بازیابیِ رمز» مصرف شود (purpose confusion → تسخیرِ حساب)، و دو
      جریان کدِ همدیگر را هم پاک می‌کردند.
    """

    __tablename__ = "otp_codes"
    __table_args__ = (Index("ix_otp_codes_phone_purpose", "phone", "purpose"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    phone: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # HMAC-SHA256ِ کد (۶۴ هگز) — کدِ خام هیچ‌جا ذخیره نمی‌شود.
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'login'")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AuthAttempt(Base):
    """تلاش‌های ورود برای قفل موقت (brute-force) — کلید بر اساس phone + بازهٔ زمانی."""

    __tablename__ = "auth_attempts"
    __table_args__ = (Index("ix_auth_attempts_phone_created_at", "phone", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LookupAttempt(Base):
    """شمارندهٔ سقفِ نرخ برای مسیرهای عمومی (بررسی وجود شماره، ورود، پیوستن، …).

    `scope` کلیدِ **ناشناسِ** سطل است: HMAC-SHA256ِ نمک‌خوردهٔ نشانیِ کلاینت (یا هر
    شناسهٔ دیگر) — خودِ نشانی ذخیره نمی‌شود تا این جدول به گزارشِ «چه کسی از کجا»
    تبدیل نشود (§5). NULL یعنی سطلِ سراسریِ نسخهٔ پیشین.
    """

    __tablename__ = "lookup_attempts"
    __table_args__ = (
        Index("ix_lookup_attempts_kind_created_at", "kind", text("created_at DESC")),
        Index(
            "ix_lookup_attempts_kind_scope_created_at",
            "kind",
            "scope",
            text("created_at DESC"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FamilyInvite(Base):
    __tablename__ = "family_invites"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # تک‌مصرفه‌سازی (رفعِ #۳): پذیرشِ دعوت لینک را می‌سوزاند (active=False) و این دو را پر می‌کند.
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
