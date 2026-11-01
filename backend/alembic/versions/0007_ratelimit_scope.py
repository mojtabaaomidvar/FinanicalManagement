"""سقفِ نرخِ per-IP — ستونِ `scope` روی `lookup_attempts` (رفعِ شکافِ #۱۵، §5.11).

این مهاجرت **افزایشی، برگشت‌پذیر و بی‌قفلِ سنگین** است (Rule 10):

۱) `lookup_attempts.scope` (Text, **nullable**). کلیدِ ناشناسِ سطلِ سقفِ نرخ —
   HMAC-SHA256ِ نمک‌خوردهٔ نشانیِ کلاینت. nullable است تا ردیف‌های موجود (که سطلِ
   سراسریِ `kind='pre_reg'` بودند) دست‌نخورده و معنادار بمانند؛ هیچ بک‌فیلی لازم
   نیست چون این جدول عمرِ یک‌ساعته دارد و خودش جارو می‌شود.

   ⚠️ نشانیِ خام هرگز در این ستون نمی‌نشیند. اگر روزی کسی خواست IP را «برای
   گزارش» ذخیره کند، آن یک تصمیمِ حریمِ خصوصیِ جداست و §5 خلافش را می‌گوید.

۲) ایندکسِ مرکبِ `(kind, scope, created_at DESC)` — پرسشِ «چند بار در پنجرهٔ
   اخیر از این سطل؟» باید index-only بماند. ایندکسِ قدیمیِ `(kind, created_at)`
   می‌ماند چون سقفِ سراسری (`kind` با پسوندِ `:all`) هنوز از آن بهره می‌برد.

این جدول عمداً بیرونِ RLS است (مهاجرت 0002): پیش از احراز هویت نوشته می‌شود و
`family_id` ندارد.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-26
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("lookup_attempts", sa.Column("scope", sa.Text(), nullable=True))
    op.execute(
        "CREATE INDEX ix_lookup_attempts_kind_scope_created_at "
        "ON lookup_attempts (kind, scope, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_lookup_attempts_kind_scope_created_at")
    op.drop_column("lookup_attempts", "scope")
