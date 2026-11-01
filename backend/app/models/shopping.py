"""§۱.۸ خرید و انبار خانه — مدل‌ها.

دلیلِ وجودِ این سه موجودیت و تصمیم‌های پشتشان در مهاجرتِ `0011_shopping.py`
مستند است (چرا دستهٔ تراکنشیِ `shopping` کافی نبود، چرا لیست و انبار دو
چیزند، چرا «سفرِ خرید» جدولِ جدا ندارد).

هر سه **زیرِ RLS + FORCE** هستند، پس هر مسیری که بخواند یا بنویسد باید
`get_tenant_member` بگیرد — همان درسی که در §۷ خوردیم.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ShoppingList(Base):
    """یک لیستِ نام‌دار («سوپرمارکت»، «داروخانه»…) — تصمیمِ مالک.

    یک لیستِ همیشگی ساده‌تر بود ولی همه‌چیز را در یک فهرستِ بلند قاطی
    می‌کرد؛ لیستِ نام‌دار فقط یک جدولِ کوچک گران‌تر است.
    """

    __tablename__ = "shopping_lists"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class InventoryItem(Base):
    """قلمِ انبارِ خانه — «چه داریم»، در برابرِ لیست که «چه بخریم» است.

    `threshold == 0` یعنی «آستانه ندارد»: نه کم شمرده می‌شود نه اعلان
    می‌دهد. پیش‌فرضِ عمدی، تا قلمی که کاربر آستانه‌اش را نگذاشته
    خودسرانه زنگ نزند.
    """

    __tablename__ = "inventory_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="quantity_not_negative"),
        CheckConstraint("threshold >= 0", name="threshold_not_negative"),
        # دو ردیفِ «شیر» با دو عدد، انبار را بی‌معنا می‌کند.
        UniqueConstraint("family_id", "title", name="uq_inventory_family_title"),
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
    title: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    threshold: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ShoppingItem(Base):
    """قلمِ یک لیست.

    به‌جای ماشینِ حالت، دو ستونِ ساده: `checked` یعنی «در سبد است» و
    `bought_at` یعنی «سفرِ خرید بسته شد». قلمِ دارای `bought_at` از لیستِ
    فعال بیرون می‌رود ولی حذف نمی‌شود — سابقهٔ خرید و پیوندِ تراکنش
    رویش است.

    `price` قیمتِ **کلِ همین سطر** است نه قیمتِ واحد؛ دلیلش در مهاجرت.
    """

    __tablename__ = "shopping_items"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("price IS NULL OR price > 0", name="price_positive"),
        Index("ix_shopping_items_list_bought", "family_id", "list_id", "bought_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # تنها CASCADEِ این ماژول: قلم بیرون از لیستش معنا ندارد.
    list_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    qty: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("1")
    )
    unit: Mapped[str | None] = mapped_column(Text)
    # عیناً نوعِ ستونِ مبلغِ تراکنش و قبض (§۶ — بازاستفادهٔ دقیقِ منطقِ ارز).
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    checked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    bought_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bought_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    # رابطهٔ Shopping ↕ Finance (§۴.۷). اقلامِ یک سفر همگی یک
    # `transaction_id` می‌گیرند، پس «سفرِ خرید» بی‌جدولِ جدا بازسازی می‌شود.
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL")
    )
    inventory_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
