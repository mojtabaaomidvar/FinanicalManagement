"""خانواده‌ها و اعضا."""

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
    Index,
    Numeric,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Family(Base):
    __tablename__ = "families"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)  # کد نمایشی خانواده
    budget: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, server_default=text("0"))
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'تومان'"))
    dark: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # سازنده (Creator) — جدا از نقش (§2.4). nullable تا خانواده بدونِ owner قفل نشود.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint("gender IS NULL OR gender IN ('male','female')", name="gender"),
        CheckConstraint("status IN ('pending','active')", name="status"),
        CheckConstraint(
            "membership_state IN "
            "('pending','active','rejected','expired','suspended','removed')",
            name="membership_state",
        ),
        CheckConstraint("theme IN ('light','dark','auto')", name="theme"),
        CheckConstraint("currency IN ('تومان','ریال')", name="currency"),
        # یکتایی شماره فقط برای مقادیر واقعی؛ چند عضو بدون شماره مجاز است.
        Index(
            "uq_members_phone", "phone",
            unique=True, postgresql_where=text("phone IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'member'"))
    phone: Mapped[str | None] = mapped_column(Text)  # 09xxxxxxxxx — یکتایی جزئی در __table_args__
    # هش رمز: Argon2id ($argon2id$…). قالب‌های قدیمی bcrypt/sha256 هنگام ورود ارتقا می‌یابند.
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    gender: Mapped[str | None] = mapped_column(Text)
    birth_date: Mapped[date | None] = mapped_column(Date)
    # national_id بازنشسته شد (درخواست مالک ۲۰۲۶-۰۹-۰۸): کدملی از کل برنامه حذف شد؛
    # ستون در مهاجرت 0001 هم ساخته نمی‌شود و دادهٔ قدیمی در فاز ۱۰ منتقل نخواهد شد.
    # national_id: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    # محورِ عضویت (چرخهٔ §2.5)، مستقل از status. پیش‌فرضِ 'active' → اعضای موجود و
    # عضوهایی که مدیر ساخته پیش‌تأییدند؛ فقط جریانِ خودپیوستن آن را 'pending' می‌گذارد.
    membership_state: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'active'")
    )
    theme: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'auto'"))
    relation: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'خودم'"))
    # واحد پول نمایشی شخصی؛ مبالغ همیشه به تومان ذخیره می‌شوند.
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'تومان'"))
    # ── §۷ اعلان‌ها (مهاجرت 0009) ──
    # کلیدِ کلیِ §۷.۳. ستونِ واقعی است چون هیچ‌وقت زیاد نمی‌شود: یک خانواده هر
    # چند ماژول هم بگیرد، «همه را خاموش کن» یکی است.
    notif_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # کلیدهای per-domain (§۷.۳) و زمانِ پیش‌هنگامِ هر دامنه (§۷.۴) —
    # {"domains": {...}, "leadDays": {...}}. JSONB است نه ستون‌به‌ازای‌دامنه،
    # چون §۷.۱ هفت منبع می‌شمارد و با هر ماژولِ تازه یکی اضافه می‌شود؛
    # ستون‌به‌ازای‌دامنه یعنی یک مهاجرت به‌ازای هر ماژول، آن هم برای یک ترجیح.
    # طرفِ خواننده عمداً مقاوم است: کلیدِ غایب = روشن، و عددِ خراب بریده می‌شود
    # (domain/notification/notification.rules.ts).
    notif_prefs: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
