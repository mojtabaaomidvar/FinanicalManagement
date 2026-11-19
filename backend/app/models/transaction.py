"""تراکنش‌ها و تصاویر پیوست.

رفع D-7: قید type اکنون 'transfer' را هم می‌پذیرد (مطابق منطق واقعی برنامه).
انتقال = یک ردیف با account_id (مبدأ) و to_account_id (مقصد) و category='transfer'.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    BigInteger,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_transactions_id_family"),
        CheckConstraint(
            "source_kind IS NULL OR source_kind IN ('vehicle_service','transfer_fee')", name="transaction_source_kind"
        ),
        CheckConstraint(
            "source_kind IS NULL OR (source_kind='vehicle_service' AND type='expense' AND category='transport' "
            "AND repeat='none' AND repeat_end IS NULL) OR (source_kind='transfer_fee' AND type='expense' "
            "AND category='finance' AND repeat='none' AND repeat_end IS NULL AND transfer_fee_for_id IS NOT NULL)",
            name="transaction_source_shape",
        ),
        # D-7 FIX: افزودن 'transfer' به قید نوع
        CheckConstraint("type IN ('expense','income','transfer')", name="type"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("repeat IN ('none','weekly','monthly','yearly')", name="repeat"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    source_kind: Mapped[str | None] = mapped_column(Text)
    transfer_fee_method: Mapped[str | None] = mapped_column(Text)
    transfer_fee_rial: Mapped[int | None] = mapped_column(BigInteger)
    transfer_fee_for_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'other-e'"))
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)  # میلادی؛ جلالی در کلاینت
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    time: Mapped[str | None] = mapped_column(Text)  # "HH:MM" اختیاری
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), index=True
    )
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL")
    )
    subcategory_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subcategories.id", ondelete="SET NULL")
    )
    repeat: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'none'"))
    repeat_end: Mapped[date | None] = mapped_column(Date)
    recurring_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    recurring_category: Mapped[str | None] = mapped_column(Text)
    recurring_note: Mapped[str | None] = mapped_column(Text)
    recurring_start_date: Mapped[date | None] = mapped_column(Date)
    recurring_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    recurring_source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    recurring_due_date: Mapped[date | None] = mapped_column(Date)
    # سررسیدهای رسیدگی‌شدهٔ تراکنش تکرارشونده (فهرست "YYYY-MM-DD")
    handled_occurrences: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )


class TransactionPhoto(Base):
    __tablename__ = "transaction_photos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    caption: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
