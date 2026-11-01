"""کدِ یک‌بارمصرف: هدف‌دار + هش‌شده (پیش‌نیازِ §9.5 «فراموشیِ رمز»).

این مهاجرت سه نقصِ **موجود** را می‌بندد، نه فقط قابلیتِ تازه‌ای اضافه کند:

۱) **`purpose` (Text, NOT NULL, DEFAULT 'login')** — تا دیروز `otp_codes` هیچ
   تفکیکی نداشت. یعنی اگر مسیرِ «بازیابیِ رمز» روی همین جدول ساخته می‌شد:
   * کدی که کاربر برای «ورود» گرفته بود، برای «تغییرِ رمز» هم کار می‌کرد
     (purpose confusion → تسخیرِ حساب)، و
   * `insert_otp` که همهٔ کدهای یک شماره را پاک می‌کند، دو جریان را به جانِ
     هم می‌انداخت.
   پیش‌فرضِ `'login'` انتخاب شد تا اگر ردیفی هم بود، معنایش عوض نشود.

۲) **`code` → `code_hash`** — کدِ یک‌بارمصرف عملاً یک اعتبارنامه است و §۵.۱۱
   می‌گوید اعتبارنامه برگشت‌پذیر ذخیره نشود. از این پس مقدارِ ستون
   HMAC-SHA256ِ فلفل‌خوردهٔ کد است (`services/otp.py`). برای این مخزن فرضِ
   «کسی جدول را نمی‌بیند» معتبر نیست: سابقهٔ پوش‌شدنِ دادهٔ واقعی به مخزنِ
   عمومی دارد.

۳) **ایندکسِ `(phone, purpose)`** — مسیرِ خواندنِ تازه همین دوتایی است.

## ⚠️ اعلانِ صریحِ قاعدهٔ ۱۰ (مهاجرتِ مخرب، نه بی‌صدا)
گامِ ۲ ردیف‌های موجودِ `otp_codes` را **حذف می‌کند**. این تصمیمِ آگاهانه است و
سه دلیل دارد:
* هش یک‌طرفه است، پس تبدیلِ ردیفِ قدیمی به طرحِ تازه ناممکن است؛ و نگه‌داشتنِ
  کدِ خام در ستونِ تازه، خودِ نقص را حفظ می‌کرد.
* محتوای این جدول ماهیتاً گذرا است: TTL پنج‌دقیقه‌ای، و `insert_otp` هر ردیفِ
  کهنه‌تر از یک ساعت را خودش جارو می‌کند. یعنی «دادهٔ کاربر» نیست.
* روی تولید امروز **صفر ردیف** دارد: صدورِ کد فقط در `dev_mode` ممکن است و آن
  پرچم هیچ‌وقت روشن نشده (هیچ کدی در بک‌اند آن را نمی‌نویسد).

بدترین حالتِ عملی: اگر دقیقاً هنگام استقرار کسی کدی در دست داشته باشد، آن کد
بی‌اثر می‌شود و باید دوباره درخواست بدهد. `downgrade` هم متقارن است.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "otp_codes",
        sa.Column(
            "purpose",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'login'"),
        ),
    )
    op.execute("CREATE INDEX ix_otp_codes_phone_purpose ON otp_codes (phone, purpose)")

    # کدهای در جریان قابل تبدیل به هش نیستند (یک‌طرفه) و نباید خام بمانند.
    op.execute("DELETE FROM otp_codes")
    op.drop_column("otp_codes", "code")
    op.add_column("otp_codes", sa.Column("code_hash", sa.Text(), nullable=False))


def downgrade() -> None:
    op.execute("DELETE FROM otp_codes")
    op.drop_column("otp_codes", "code_hash")
    op.add_column("otp_codes", sa.Column("code", sa.Text(), nullable=False))
    op.execute("DROP INDEX IF EXISTS ix_otp_codes_phone_purpose")
    op.drop_column("otp_codes", "purpose")
