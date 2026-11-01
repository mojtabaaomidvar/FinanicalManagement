"""§۱.۹ قبوض و شارژ — قبض = تعهدِ پرداخت‌نشده.

دلیلِ وجودِ این موجودیت و تصمیم‌های پشتش در مهاجرتِ `0010_bills.py` مستند
است (چرا «دستهٔ قبضِ تراکنش» کافی نبود، چرا پرداخت تراکنش می‌سازد، چرا
تکرارِ دوره‌ای و تقسیمِ سهم در این برش نیستند).

این جدول **زیرِ RLS** است، پس هر مسیری که بخواند یا بنویسد باید
`get_tenant_member` بگیرد — همان درسی که در §۷ خوردیم (یادداشتِ
`models/notification.py`).
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
    Index,
    Numeric,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: نوعِ قبض. «charge» شارژِ ساختمان است — موجودیتِ جدا نشد چون تفاوتش
#: مبلغِ ثابت و نداشتنِ شناسهٔ قبض است و هر دو فیلدِ اختیاری‌اند.
BILL_KINDS = ("electricity", "water", "gas", "internet", "phone", "charge", "other")
BILL_STATES = ("unpaid", "paid", "cancelled")


class Bill(Base):
    __tablename__ = "bills"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ",".join(f"'{k}'" for k in BILL_KINDS) + ")", name="kind"
        ),
        CheckConstraint(
            "state IN (" + ",".join(f"'{s}'" for s in BILL_STATES) + ")", name="state"
        ),
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_bills_state_due", "family_id", "state", "due_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # عیناً نوعِ ستونِ مبلغِ تراکنش (§۶ — بازاستفادهٔ دقیقِ منطقِ ارز).
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # میلادی؛ جلالی در کلاینت — عیناً قراردادِ transactions.date.
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    # شناسهٔ قبض / شناسهٔ پرداختِ ایرانی. **متن** نه عدد: صفرِ ابتدایی دارند.
    bill_no: Mapped[str | None] = mapped_column(Text)
    payment_no: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'unpaid'")
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    # رابطهٔ Bill ↕ Finance (§۴.۷). SET NULL — دلیلش در مهاجرت 0010.
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
