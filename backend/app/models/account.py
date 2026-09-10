"""حساب‌ها/کیف‌پول‌ها و پیش‌شماره‌های کارت (BIN)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (CheckConstraint("kind IN ('bank','wallet')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)   # نام دلخواه
    bank: Mapped[str | None] = mapped_column(Text)
    card_number: Mapped[str | None] = mapped_column(Text)      # ۱۶ رقم
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'bank'"))
    # موجودی اولیه؛ تراکنش‌ها روی این مبنا جمع می‌شوند (بدون اعشار)
    initial_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 0), nullable=False, server_default=text("0")
    )


class CardBin(Base):
    __tablename__ = "card_bins"
    __table_args__ = (CheckConstraint(r"bin ~ '^\d{6}$'", name="bin_format"),)

    bin: Mapped[str] = mapped_column(Text, primary_key=True)
    bank: Mapped[str] = mapped_column(Text, nullable=False)
