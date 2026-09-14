"""رضایتِ صریح برای تشخیص تراکنش از پیامک (فاز ۱ از وظیفهٔ «تشخیص هوشمند»)

تا پیش از این، خواندن پیامک یک کلیدِ سراسریِ نانوشته بود: اپ اندروید در اولین
ورود اجازه می‌گرفت و از آن به بعد «هر» پیامکی را به سرور می‌فرستاد. این مهاجرت
زیرساختِ داده‌ایِ چیزی را می‌سازد که باید از اول می‌بود: رضایتِ «به‌ازای هر حساب».

سه تصمیم که بعداً عوض‌کردنشان گران است:

۱) sms_enabled روی خودِ accounts نشست، نه جدولِ تنظیماتِ جدا. چون دقیقاً یک
   بیت به‌ازای هر حساب است و جدولِ جدا یعنی join در مسیرِ داغِ ingest و یک
   حالتِ اضافه («ردیفِ تنظیمات نیست» در برابر «هست ولی false»). الگوهای
   نمونه و قالب‌های یادگیری — که چند-ردیفی‌اند — در فاز بعد جدولِ خود را
   می‌گیرند. server_default=false عمدی است: حساب‌های موجود باید خاموش
   بیدار شوند، وگرنه مهاجرت خودش همان رضایتِ نگرفته را تثبیت می‌کرد.

۲) sms_senders به account وصل است نه به family. یعنی «۶۰۰۰۰۰ مالِ کارتِ ملت
   است»، نه «مالِ این خانواده». بدون این، فعال‌کردنِ یک کارت درِ همهٔ
   پیامک‌های بانکیِ خانواده را باز می‌کرد و بندِ «هر حساب مستقل» بی‌معنا
   می‌شد. ستون family_id با وجودِ account_id تکراری به‌نظر می‌رسد ولی
   لازم است: محمولِ RLS روی family_id است و بدونش این جدول از مرزِ
   چند-مستأجری بیرون می‌افتاد.

۳) sms_numbers ستون verified دارد در حالی که هنوز هیچ کدِ تأییدی فرستاده
   نمی‌شود (تصمیم مالک ۲۰۲۶-۰۹-۱۳: بدون کد، فقط اعلام). ستون می‌ماند تا
   UI بتواند صادقانه «تأیید نشده» نشان دهد؛ اگر روزی پنل پیامکی آمد،
   مسیرش باز است. شمارهٔ ثبت‌نام اینجا ذخیره نمی‌شود — روی members هست و
   کپی‌کردنش یعنی دو منبعِ حقیقت که بی‌صدا از هم جدا می‌شوند.

sms_messages دو ستون می‌گیرد: sender (تا معلوم باشد پیامک از کجا آمده و
کاربر بتواند از رویش سرشماره بسازد) و account_id (نتیجهٔ انتساب؛ NULL یعنی
«نیازمند بررسی»، نه «بی‌حساب»). ondelete برای account_id عمداً SET NULL
است نه CASCADE: پاک‌کردنِ یک کارت نباید تاریخچهٔ پیامک‌های ثبت‌شده را ببلعد.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-13
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمول fail-closed مهاجرت 0002 — نبود GUC یعنی صفر ردیف.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_NEW_TABLES = ("sms_senders", "sms_numbers")


def upgrade() -> None:
    # ── ۱) کلیدِ رضایت روی هر حساب ───────────────────────────
    op.add_column(
        "accounts",
        sa.Column(
            "sms_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ── ۲) فرستنده‌های مجازِ هر حساب ─────────────────────────
    op.create_table(
        "sms_senders",
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
            "account_id",
            UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sender", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # یک سرشماره دو بار برای یک حساب بی‌معناست؛ ولی همان سرشماره برای
        # حسابِ دیگر کاملاً عادی است (دو کارت از یک بانک).
        sa.UniqueConstraint("account_id", "sender", name="uq_sms_senders_account_sender"),
    )
    op.create_index("ix_sms_senders_family_id", "sms_senders", ["family_id"])
    op.create_index("ix_sms_senders_account_id", "sms_senders", ["account_id"])

    # ── ۳) شماره‌های مجازِ هر عضو ────────────────────────────
    op.create_table(
        "sms_numbers",
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
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "verified", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("member_id", "phone", name="uq_sms_numbers_member_phone"),
    )
    op.create_index("ix_sms_numbers_family_id", "sms_numbers", ["family_id"])

    # ── ۴) ردِ پیامک: از کجا آمد و به کدام حساب خورد ─────────
    op.add_column("sms_messages", sa.Column("sender", sa.Text(), nullable=True))
    op.add_column(
        "sms_messages",
        sa.Column(
            "account_id",
            UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ── ۵) همان مرزِ چند-مستأجریِ مهاجرت 0002 ────────────────
    for table in _NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_family_isolation ON {table} "
            f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
        )


def downgrade() -> None:
    for table in _NEW_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_family_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_column("sms_messages", "account_id")
    op.drop_column("sms_messages", "sender")

    op.drop_index("ix_sms_numbers_family_id", table_name="sms_numbers")
    op.drop_table("sms_numbers")

    op.drop_index("ix_sms_senders_account_id", table_name="sms_senders")
    op.drop_index("ix_sms_senders_family_id", table_name="sms_senders")
    op.drop_table("sms_senders")

    op.drop_column("accounts", "sms_enabled")
