"""RLS واقعی روی جدول‌های دادهٔ خانواده‌محور (فاز ۵ — دفاع در عمق)

مرز چند-مستأجری در سطح دیتابیس: حتی اگر لایهٔ اپ فیلترِ family_id را فراموش کند،
خودِ Postgres ردیف‌های خانواده‌های دیگر را نه می‌خواند و نه می‌نویسد.

دامنه (تصمیم مالک ۲۰۲۶-۰۹-۰۸): فقط جدول‌های «همیشه‌احرازشده» که پیش از داشتنِ
زمینهٔ خانواده هرگز خوانده نمی‌شوند. جدول‌های بوت‌استرپِ هویت (members, families,
family_invites) و جدول‌های سراسری/احراز (sessions, otp_codes, auth_attempts,
lookup_attempts, card_bins, app_settings) عمداً بیرون‌اند: ورود با شماره، ثبت‌نام و
باز کردن لینک دعوت پیش از هر زمینه‌ای به آن‌ها دسترسی دارند؛ آن‌ها با tenancy لایهٔ
اپ محافظت می‌شوند.

مکانیزم: هر درخواستِ احرازشده در همان تراکنش
`set_config('app.family_id', <uuid>, true)` را می‌گذارد (لایهٔ app/db/rls.py).
پالیسی روی این GUC فیلتر می‌کند. **fail-closed**: اگر GUC تنظیم نشده باشد،
`NULLIF(current_setting('app.family_id', true), '')::uuid` برابر NULL می‌شود و
`family_id = NULL` هیچ‌گاه true نیست → صفر ردیف دیده می‌شود و هر نوشتن رد می‌شود.

FORCE لازم است چون اپ (فعلاً) با نقشِ مالکِ جدول‌ها متصل می‌شود و مالک به‌صورت
پیش‌فرض از RLS معاف است؛ FORCE مالک را هم مشمول می‌کند. (نقشِ کم‌دسترسیِ جدا =
سخت‌سازیِ اختیاریِ فاز ۱۱ وقتی هاست مشخص شد.)

⚠️ ترتیب بار دادهٔ فاز ۱۰: چون FORCE، بارِ data-only به‌عنوان همان نقش مشمول RLS
می‌شود و INSERTها رد می‌شوند. پس ترتیب درست:
    alembic upgrade 0001   →   بارِ pg_dump --data-only   →   alembic upgrade head
(یعنی 0002 «بعد از» ورود داده اجرا شود.) جایگزین: در ری‌استور به‌عنوان superuser
`SET row_security = off`.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-08
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# جدول‌های «همیشه‌احرازشده» که RLS خانواده می‌گیرند (هر کدام ستون family_id دارند).
# عمداً بدون members/families/family_invites (بوت‌استرپِ هویت) و بدون جدول‌های سراسری.
_TENANT_TABLES: tuple[str, ...] = (
    "transactions",
    "transaction_photos",
    "accounts",
    "subcategories",
    "custom_categories",
    "category_budgets",
    "sms_messages",
    "sms_bridges",
    "family_events",
)

# محمولِ مشترک: fail-closed؛ NULLIF از خطای ''::uuid جلوگیری می‌کند و نبودِ GUC → NULL → رد.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def _policy_name(table: str) -> str:
    return f"{table}_family_isolation"


def upgrade() -> None:
    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        # FORCE تا مالکِ جدول هم مشمول شود (اپ فعلاً با نقشِ مالک متصل است).
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {_policy_name(table)} ON {table} "
            f"FOR ALL "
            f"USING ({_PREDICATE}) "
            f"WITH CHECK ({_PREDICATE})"
        )


def downgrade() -> None:
    for table in _TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {_policy_name(table)} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
