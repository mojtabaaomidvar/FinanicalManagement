"""دارایی‌های بازاری — مقدارِ نگهداری‌شده از طلا/ارز/رمزارز/سهم.

اینجا هیچ مبلغی ذخیره نمی‌شود؛ فقط «چه‌قدر از چه چیزی». ارزش هنگام خواندن از
قیمتِ روزِ بازار حساب می‌شود (services/holdings.py). دلیل در مهاجرت 0004 آمده.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('gold','currency','crypto','stock')", name="ck_holdings_kind"
        ),
        CheckConstraint("quantity > 0", name="ck_holdings_quantity_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    # gold | currency | crypto | stock — تعیین می‌کند قیمت از کدام منبع بیاید
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # نمادِ بالادست؛ کلیدِ پیوند به قیمت
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    # عکسِ لحظه‌ایِ نام — اگر نماد از بالادست حذف شد، ردیف خوانا بماند
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # واحدِ قیمت در لحظهٔ ثبت (تومان/ریال) — فقط برای نمایش
    unit: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    # اعشاردار: «۲٫۵ گرم» یا «۰٫۰۳ بیت‌کوین» بدونِ اعشار بیان نمی‌شود
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
