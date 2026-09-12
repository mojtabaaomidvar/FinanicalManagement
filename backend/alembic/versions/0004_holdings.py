"""دارایی‌های بازاری (طلا، ارز، رمزارز، سهم) + RLS خانواده

کاربر مقدار را نگه می‌دارد و ارزش هر بار از قیمتِ روزِ بازار حساب می‌شود؛
هیچ مبلغی اینجا ذخیره نمی‌شود. این عمدی است: «۲ سکه» با گذشتِ زمان معنایش
عوض نمی‌شود ولی ارزشش می‌شود، پس ذخیرهٔ مبلغ یعنی داده‌ای که بی‌صدا کهنه می‌شود.

سه تصمیم که بعداً گران درمی‌آیند اگر عوض شوند:

۱) quantity از نوع Numeric(18,6) است نه Numeric(18,0). جدولِ accounts اعشار
   ندارد چون تومان صحیح است، ولی «۲٫۵ گرم طلا» یا «۰٫۰۳ بیت‌کوین» بدونِ اعشار
   اصلاً بیان نمی‌شود. شش رقمِ اعشار برای رمزارزهای گران هم کافی است.

۲) name کنارِ symbol ذخیره می‌شود — یعنی عکسِ لحظه‌ایِ نام. اگر بالادست نمادی
   را حذف یا تغییرِ نام دهد، ردیفِ کاربر همچنان خوانا می‌ماند («۲ سکه امامی»)
   حتی وقتی دیگر نمی‌شود قیمتش را گرفت. بدونِ این، فهرستِ دارایی‌ها به ردیف‌های
   بی‌نامِ قابلِ‌شناسایی‌نشدنی تبدیل می‌شد.

۳) kind ذخیره می‌شود تا موقعِ قیمت‌گذاری معلوم باشد سراغِ کدام منبع برویم:
   gold/currency/crypto از اسنپ‌شاتِ Gold_Currency می‌آیند ولی stock از فهرستِ
   AllSymbols. بدونِ kind باید در هر چهار فهرست دنبالِ نماد می‌گشتیم و یک
   هم‌نامیِ اتفاقی قیمتِ غلط می‌داد.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-12
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمولِ fail-closed مهاجرتِ 0002 — نبودِ GUC یعنی صفر ردیف.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_POLICY = "holdings_family_isolation"


def upgrade() -> None:
    op.create_table(
        "holdings",
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
            "member_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "kind IN ('gold','currency','crypto','stock')", name="ck_holdings_kind"
        ),
        # مقدارِ صفر یا منفی دارایی نیست؛ کاربر باید ردیف را حذف کند نه صفر کند.
        sa.CheckConstraint("quantity > 0", name="ck_holdings_quantity_positive"),
    )
    op.create_index("ix_holdings_family_id", "holdings", ["family_id"])

    op.execute("ALTER TABLE holdings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE holdings FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {_POLICY} ON holdings "
        f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON holdings")
    op.execute("ALTER TABLE holdings NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE holdings DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_holdings_family_id", table_name="holdings")
    op.drop_table("holdings")
