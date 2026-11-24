"""پیام‌های بانکی و پل پیامک."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    Text,
    ForeignKeyConstraint,
    Index,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SmsMessage(Base):
    __tablename__ = "sms_messages"
    __table_args__ = (
        CheckConstraint("type IS NULL OR type IN ('expense','income')", name="type"),
        CheckConstraint("status IN ('pending','recorded','ignored')", name="status"),
        ForeignKeyConstraint(["transaction_id", "family_id"], ["transactions.id", "transactions.family_id"],
                             name="sms_transaction_family", ondelete="SET NULL (transaction_id)"),
        CheckConstraint("transaction_id IS NULL OR status = 'recorded'", name="sms_link_recorded"),
        Index("sms_identity_unique", "family_id", "member_id", "identity_key", unique=True,
              postgresql_where=text("identity_key IS NOT NULL")),
        Index("sms_transaction_unique", "transaction_id", unique=True,
              postgresql_where=text("transaction_id IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    bank: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    balance: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    date: Mapped[date | None] = mapped_column(Date)
    time: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transport_id: Mapped[str | None] = mapped_column(Text)
    identity_key: Mapped[str | None] = mapped_column(Text)
    parser_version: Mapped[str | None] = mapped_column(Text)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # فرستندهٔ پیامک (سرشماره یا شماره). ذخیره می‌شود تا کاربر بتواند از روی
    # همین پیامک سرشمارهٔ مجاز بسازد و در فهرست ببیند پیامک از کجا آمده.
    sender: Mapped[str | None] = mapped_column(Text)
    # حسابی که پیامک به آن نسبت داده شد. NULL یعنی «نیازمند بررسی» — یعنی
    # پذیرفته شده ولی هنوز معلوم نیست مالِ کدام حساب است؛ نه «بی‌حساب».
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL")
    )


class SmsBridge(Base):
    __tablename__ = "sms_bridges"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SmsSender(Base):
    """سرشماره/شمارهٔ فرستندهٔ مجاز — به‌ازای هر حساب، نه هر خانواده.

    به account وصل است تا فعال‌کردن یک کارت درِ پیامک‌های بقیهٔ حساب‌ها را
    باز نکند. family_id با وجود account_id تکراری به‌نظر می‌رسد ولی محمول
    RLS روی آن است.
    """

    __tablename__ = "sms_senders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SmsNumber(Base):
    """شمارهٔ «اضافه»ای که کاربر به‌عنوان منبع مجاز اعلام کرده.

    شمارهٔ ثبت‌نام اینجا نیست (روی members است) تا دو منبعِ حقیقت نسازیم.
    verified فعلاً همیشه false است — هنوز کدِ تأییدی فرستاده نمی‌شود و UI
    باید همین را صادقانه نشان دهد.

    مهم: وجود ردیف در این جدول به‌تنهایی اجازهٔ خواندن نمی‌دهد؛ فقط
    می‌گوید این شماره «منبع مجاز» است. اینکه چه چیزی بررسی شود را
    accounts.sms_enabled و sms_senders تعیین می‌کنند.
    """

    __tablename__ = "sms_numbers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
