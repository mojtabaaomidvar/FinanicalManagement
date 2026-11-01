"""§۱.۹ «قبوض و شارژ» — موجودیتِ قبض به‌عنوانِ **تعهدِ پرداخت‌نشده**.

## چرا موجودیتِ تازه، در حالی که «قبض» از قبل یک دستهٔ تراکنش است؟

ممیزیِ پیش‌از‌کد (قاعدهٔ ۳۱) نشان داد `bills` از قبل در `_FIXED_CATEGORIES`
هست و تراکنشِ تکرارشونده (`repeat` + `handled_occurrences`) اجاره و قسط را
کامل پوشش می‌دهد. پس آن‌چه کم است «نوعِ دیگری از تراکنش» نیست:

**قبض پیش از آنکه «پرداخت» شود، یک «بدهی» است.** امروز مبلغِ قبض فقط در
لحظه‌ای به وجود می‌آید که کاربر پرداختش را ثبت کند؛ حالتِ «قبضِ برق آمد،
۴۸۰ هزار تومان، سررسید ۱۴۰۵/۰۸/۱۵، هنوز پرداخت نشده» هیچ‌جا نمی‌نشیند. این
جدول همان حالت را مدل می‌کند، نه پرداخت را.

## رابطهٔ `Bill ↕ Finance` (§۴.۷) — تصمیمِ مالک

«پرداخت شد» زدن، قبض را می‌بندد **و** یک تراکنشِ هزینه در دستهٔ `bills`
می‌سازد، و شناسه‌اش در `transaction_id` می‌نشیند. انتخابِ آگاهانه بود: یک
منبعِ حقیقت برای پول، پس خرجِ ماه و بودجه خودبه‌خود درست می‌مانند و
**شمارشِ دوبل ممکن نیست**. سرویس هر دو را در یک commit انجام می‌دهد
(`transactions.create_uncommitted`).

`ondelete="SET NULL"` روی `transaction_id`: اگر کاربر آن تراکنش را حذف کند،
قبض می‌ماند و «پرداخت‌شده» هم می‌ماند، فقط پیوندش گم می‌شود. CASCADE بدتر
بود (خودِ سندِ قبض را می‌برد) و RESTRICT کاربر را از حذفِ تراکنشِ خودش
منع می‌کرد. این کم‌بدترین حالت است، نه حالتِ بی‌عیب.

## تکرارِ دوره‌ای عمداً نیست

قبضِ برق/آب/گاز مبلغش هر دوره **متغیر** است، پس «قبضِ تکرارشونده» یک
*الگو* می‌خواهد نه یک نمونه — و آن دامنه را دو برابر می‌کرد. برای تعهدِ
ثابت و دوره‌ای (اجاره، قسط) تراکنشِ تکرارشونده از قبل وجود دارد و §۷ هم
برایش اعلان می‌دهد. جریانِ واقعی همین است: قبض می‌آید، ثبتش می‌کنی.

## تقسیمِ سهم در این برش نیست

تصمیمِ مالک: فعلاً فقط «چه کسی پرداخت کرد» (`paid_by_member_id`).
تقسیمِ سهم جدولِ سهم + حالتِ تسویه + ماندهٔ هر عضو می‌خواهد.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-09
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمولِ fail-closed مهاجرت‌های 0002/0005/0006/0009.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"

# نوعِ قبض. «charge» همان شارژِ ساختمان است — تصمیمِ مالک این بود که
# موجودیتِ جدا نشود، چون تفاوتش عملاً مبلغِ ثابت و بی‌شناسهٔ‌قبض‌بودن است و
# هر دو فیلدِ اختیاری‌اند، نه ساختارِ متفاوت.
_KINDS = ("electricity", "water", "gas", "internet", "phone", "charge", "other")
_STATES = ("unpaid", "paid", "cancelled")


def upgrade() -> None:
    kinds = ",".join(f"'{k}'" for k in _KINDS)
    states = ",".join(f"'{s}'" for s in _STATES)

    op.create_table(
        "bills",
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
        # سازنده — برای «کی این قبض را وارد کرد». SET NULL چون حذفِ عضو
        # نباید سندِ قبضِ خانواده را ببرد.
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        # عیناً نوعِ ستونِ مبلغِ تراکنش — §۶ الزامِ «بازاستفادهٔ دقیقِ منطقِ
        # ارزِ موجود؛ هرگز نمایشِ موازی یا ناهم‌خوان». واحدِ پایه تومان.
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        # میلادی ذخیره می‌شود، جلالی نمایش داده می‌شود (§۶) — عیناً
        # قراردادِ `transactions.date`.
        sa.Column("due_date", sa.Date(), nullable=False),
        # شناسهٔ قبض / شناسهٔ پرداختِ ایرانی (۱۳ رقمی). اختیاری و متن، نه
        # عدد: صفرِ ابتدایی دارند و با عدد شدن می‌افتد. درِ پرداخت از راهِ
        # بانک را برای آینده باز می‌گذارد.
        sa.Column("bill_no", sa.Text(), nullable=True),
        sa.Column("payment_no", sa.Text(), nullable=True),
        sa.Column(
            "state", sa.Text(), nullable=False, server_default=sa.text("'unpaid'")
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "paid_by_member_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # رابطهٔ Bill ↕ Finance (§۴.۷) — دلیلِ SET NULL بالای فایل.
        sa.Column(
            "transaction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(f"kind IN ({kinds})", name="kind"),
        sa.CheckConstraint(f"state IN ({states})", name="state"),
        # مبلغِ صفر یا منفی قبض نیست. همان قاعدهٔ `_prepare`ِ تراکنش، این‌جا
        # در سطحِ دیتابیس هم بسته می‌شود تا هیچ مسیری نتواند دورش بزند.
        sa.CheckConstraint("amount > 0", name="amount_positive"),
    )
    op.create_index("ix_bills_family_id", "bills", ["family_id"])
    # مسیرِ خواندنِ اصلی: «قبض‌های پرداخت‌نشده به‌ترتیبِ سررسید».
    op.create_index("ix_bills_state_due", "bills", ["family_id", "state", "due_date"])

    # مرزِ چند-مستأجریِ دیتابیس — عیناً الگوی 0002/0005/0006/0009.
    op.execute("ALTER TABLE bills ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE bills FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY bills_family_isolation ON bills "
        f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS bills_family_isolation ON bills")
    op.execute("ALTER TABLE bills NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE bills DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_bills_state_due", table_name="bills")
    op.drop_index("ix_bills_family_id", table_name="bills")
    op.drop_table("bills")
