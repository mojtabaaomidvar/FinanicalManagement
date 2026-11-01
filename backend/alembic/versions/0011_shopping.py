"""§۱.۸ «خرید و انبار خانه» — سه جدول، و دلیلِ هرکدام.

## چرا موجودیتِ تازه، در حالی که `shopping` از قبل یک دستهٔ تراکنش است؟

ممیزیِ پیش‌از‌کد (قاعدهٔ ۳۱) نشان داد در کلِ مخزن از «خرید» فقط چهار چیز
هست: دستهٔ تراکنشیِ `shopping`، رنگش، یک کاشیِ «به‌زودی»، و نگاشتِ واژهٔ
«خرید» در تحلیل‌گرِ پیامک. همه دربارهٔ **پولی که خرج شده** است.

آن‌چه کم است پولِ خرج‌شده نیست؛ **قصدِ خرید** است: «شیر تمام شده، یادت
نرود». این حالت پیش از هر تراکنشی وجود دارد و بعد از آن هم باید رد پایش
بماند. همان نسبتی که قبض با پرداخت دارد (`0010_bills.py`).

## چرا دو موجودیت، نه یکی؟ (تصمیمِ مالک: «لیست خرید + انبار خانه»)

- **لیست خرید** پاسخِ «چه بخریم» است — کوتاه‌عمر، تیک می‌خورد، تمام می‌شود.
- **انبار خانه** پاسخِ «چه داریم» است — ماندگار، عدد دارد، و وقتی از
  آستانه پایین‌تر رفت خودش موضوعِ `InventoryBelowThreshold`ِ §۴.۹ می‌شود.

یکی‌کردنشان یعنی ردیفی که هم‌زمان «نداریمش» و «۲ تا داریم» را بگوید.

و همین دوگانگی، «اقلامِ همیشگی» را هم بی‌جدولِ سوم حل می‌کند: قلمِ
تکرارشونده همان ردیفِ انبار است که کم می‌شود و با یک لمس به لیست می‌رود.

## رابطهٔ `Shopping ↕ Finance` (§۴.۷ و §۶) — تصمیمِ مالک

قیمت روی هر قلم **اختیاری** است و لیست بی‌قیمت هم کار می‌کند. در پایانِ
خرید («خرید انجام شد») جمعِ قیمت‌ها یک تراکنشِ هزینه در دستهٔ `shopping`
می‌سازد و `transaction_id`ِ همهٔ اقلامِ آن سفر روی همان تراکنش می‌نشیند —
یعنی «سفرِ خرید» بی‌جدولِ چهارم از روی `transaction_id` بازسازی می‌شود.

`amount`/`price` عیناً `Numeric(15, 2)` است، مثلِ `transactions.amount` و
`bills.amount` — §۶ «بازاستفادهٔ دقیقِ منطقِ ارزِ موجود؛ هرگز نمایشِ موازی».

`ondelete="SET NULL"` روی `transaction_id` و `inventory_item_id`: حذفِ
تراکنش یا حذفِ ردیفِ انبار نباید سابقهٔ خرید را ببرد، فقط پیوند را.

## دو چیزی که عمداً در این برش نیست

**آفلاین‌نویسی** (§۸.۳) — تصمیمِ مالک «الان آنلاین، آفلاین مرحلهٔ جدا».
صفِ نوشتن و نمایشِ تعارضِ §۸.۴ یک زیرساختِ مستقل است و نیمه‌ساختنش یعنی
گم‌شدنِ بی‌صدای تغییرات، که خودِ §۸.۴ منعش کرده.

**تقسیمِ سهمِ خرید** — همان تصمیمی که در قبوض گرفته شد: فعلاً فقط «چه کسی
خرید» (`bought_by_member_id`).

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-12
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمولِ fail-closed مهاجرت‌های 0002/0005/0006/0009/0010.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"

_TABLES = ("shopping_lists", "shopping_items", "inventory_items")


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {table}_family_isolation ON {table} "
        f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def upgrade() -> None:
    # ── لیست‌های نام‌دار ──────────────────────────────────────
    op.create_table(
        "shopping_lists",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_shopping_lists_family_id", "shopping_lists", ["family_id"])

    # ── انبار خانه ───────────────────────────────────────────
    op.create_table(
        "inventory_items",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        # واحد آزاد است (عدد/کیلو/بسته/لیتر…) چون خانه‌ها واژهٔ خودشان را
        # دارند و فهرستِ بسته فقط کاربر را دور می‌زد.
        sa.Column("unit", sa.Text(), nullable=True),
        sa.Column(
            "quantity", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")
        ),
        # آستانهٔ کمبود. صفر یعنی «آستانه ندارد» — پس هیچ‌وقت کم شمرده
        # نمی‌شود و اعلانی نمی‌دهد. این پیش‌فرض عمدی است: قلمی که کاربر
        # آستانه‌اش را تعیین نکرده نباید خودسرانه زنگ بزند.
        sa.Column(
            "threshold", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("quantity >= 0", name="quantity_not_negative"),
        sa.CheckConstraint("threshold >= 0", name="threshold_not_negative"),
        # دو ردیفِ «شیر» با دو عدد، انبار را از معنا می‌اندازد. یکتایی
        # در سطحِ دیتابیس بسته می‌شود تا هیچ مسیری نتواند دورش بزند؛ پیامِ
        # فارسیِ درست از سرویس می‌آید.
        sa.UniqueConstraint("family_id", "title", name="uq_inventory_family_title"),
    )
    op.create_index("ix_inventory_items_family_id", "inventory_items", ["family_id"])

    # ── اقلامِ لیست ──────────────────────────────────────────
    op.create_table(
        "shopping_items",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # حذفِ لیست یعنی حذفِ اقلامش — برخلافِ بقیهٔ پیوندها این یکی
        # CASCADE است چون قلم بیرون از لیستش معنا ندارد.
        sa.Column(
            "list_id",
            UUID(as_uuid=True),
            sa.ForeignKey("shopping_lists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "qty", sa.Numeric(10, 2), nullable=False, server_default=sa.text("1")
        ),
        sa.Column("unit", sa.Text(), nullable=True),
        # قیمتِ **کلِ همین سطر** است، نه قیمتِ واحد. عمدی: کاربر سرِ صندوق
        # «چقدر شد؟» را می‌داند، نه «هر کیلو چند». ضربِ خودکار فقط جای
        # اشتباه باز می‌کرد.
        sa.Column("price", sa.Numeric(15, 2), nullable=True),
        sa.Column(
            "checked", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        # دو ستونِ ساده به‌جای ماشینِ حالت: `checked` یعنی «در سبد است»،
        # `bought_at` یعنی «سفرِ خرید بسته شد». قلمِ دارای `bought_at`
        # دیگر در لیستِ فعال نیست.
        sa.Column("bought_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "bought_by_member_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "transaction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # پیوند به انبار — اگر پر باشد، بستنِ سفرِ خرید موجودیِ آن ردیف را
        # به اندازهٔ `qty` بالا می‌برد.
        sa.Column(
            "inventory_item_id",
            UUID(as_uuid=True),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("qty > 0", name="qty_positive"),
        sa.CheckConstraint("price IS NULL OR price > 0", name="price_positive"),
    )
    op.create_index("ix_shopping_items_family_id", "shopping_items", ["family_id"])
    # مسیرِ خواندنِ اصلی: «اقلامِ نخریدهٔ یک لیست».
    op.create_index(
        "ix_shopping_items_list_bought",
        "shopping_items",
        ["family_id", "list_id", "bought_at"],
    )

    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_family_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_shopping_items_list_bought", table_name="shopping_items")
    op.drop_index("ix_shopping_items_family_id", table_name="shopping_items")
    op.drop_table("shopping_items")
    op.drop_index("ix_inventory_items_family_id", table_name="inventory_items")
    op.drop_table("inventory_items")
    op.drop_index("ix_shopping_lists_family_id", table_name="shopping_lists")
    op.drop_table("shopping_lists")
