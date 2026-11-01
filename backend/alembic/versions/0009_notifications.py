"""§۷ اعلان‌ها: ترجیحاتِ per-member + نادیده‌گرفته‌ها.

مرحلهٔ C (§۷) فقط کانالِ **درون‌نرم‌افزاری** دارد؛ پوش ساخته نمی‌شود (یادداشتِ
تاریخ‌دارِ زیرِ §7.2 در `docs/master-prompt.md`). پس این مهاجرت نه جدولِ اشتراکِ
پوش می‌سازد، نه کلیدِ VAPID — §۷.۲ صریحاً می‌گوید «برای کانال‌های استفاده‌نشده
انتزاعِ حدسی نساز».

## ۱) ترجیحاتِ اعلان روی `members` — دو ستون، نه یکی

ترجیح per-member است (الگوی موجود: `theme`/`currency`/`relation` همگی ستونِ
`members`اند؛ `app_settings` سراسری و تک‌ردیفی است پس جایش نبود).

ولی **یک ستون نشد، دو ستون شد** و تقسیمش عمدی است:

* `notif_enabled` (Boolean) — کلیدِ کلیِ §۷.۳. چیزی است که هیچ‌وقت زیاد
  نمی‌شود: یک خانواده هر چند ماژول هم بگیرد، «همه را خاموش کن» یکی است. پس
  ستونِ واقعی با پیش‌فرضِ سرور.
* `notif_prefs` (JSONB) — کلیدهای per-domain و زمانِ پیش‌هنگامِ هر دامنه.
  این‌ها **مجموعهٔ باز**اند: §۷.۱ هفت منبع می‌شمارد (قبض، خودرو، سند، خرید،
  کارِ خانه، تقویم، عضویت) و با هر ماژولِ تازه یکی اضافه می‌شود. ستون‌به‌ازای‌
  دامنه یعنی یک مهاجرت به‌ازای هر ماژول — آن هم برای یک *ترجیح*. پس نقشه در
  JSONB می‌نشیند.

خطرِ شناخته‌شدهٔ JSONB (نبودِ CHECK) آگاهانه پذیرفته شد، چون طرفِ خواننده از
قبل مقاوم است و این با آزمونِ اجرایی وارسی شده، نه فرض:
`domain/notification/notification.rules.ts` کلیدِ غایب را **روشن** می‌گیرد
(سکوتِ پیش‌فرض همان باگی است که کسی گزارش نمی‌کند) و `safeLead` هر عددِ
NaN/منفی/کسری/بزرگ را به بازهٔ [۰، MAX_LEAD_DAYS] می‌بُرد.

پیش‌فرضِ `'{}'` یعنی «هیچ ترجیحی ثبت نشده» و همان رفتارِ پیش‌فرضِ کد را
می‌دهد؛ پس ردیف‌های موجود بی‌هیچ backfill درست می‌مانند.

## ۲) `notification_dismissals` — فقط «نادیده گرفتم»

اعلان‌ها خودشان ذخیره **نمی‌شوند** (مشتق‌شده‌اند؛ دلیلش در یادداشتِ §7.1). از
سه منبعِ فعال، دو تا خودپاک‌کن‌اند: سررسید با رسیدگی می‌رود و درخواستِ عضویت
با تأیید/رد. تنها رویدادِ کنش‌ناپذیر (تولد) جایی برای رفتن ندارد، پس همین یک
چیز ماندگار می‌شود.

`member_id` در کلیدِ یکتا هست چون نادیده‌گرفتنِ یادآورِ تولد توسطِ یک عضو
نباید آن را برای بقیهٔ خانواده هم خفه کند.

`family_id` هم هست — نه برای کوئری، بلکه چون محمولِ RLS این مخزن روی همان
ستون بسته می‌شود. بی آن، ردیف از مرزِ چند-مستأجری بیرون می‌افتاد.

**چرا هرس لازم است و چرا بی‌خطر است:** کلید تاریخ را در خود دارد
(`event:<id>:<YYYY-MM-DD>`) و اعلان فقط داخلِ بازهٔ پیش‌هنگام دیده می‌شود، پس
به‌محضِ گذشتنِ آن تاریخ، ردیفِ نادیده‌گرفتن دیگر هیچ‌وقت با چیزی تطبیق نمی‌کند
— حتی تولدِ سالِ بعد، چون کلیدش تاریخِ دیگری دارد. یعنی ردیف‌های کهنه صرفاً
وزنِ مرده‌اند و حذفشان رفتار را عوض نمی‌کند. سرویس هنگامِ نوشتن ردیف‌های
کهنه‌تر از ۱۸۰ روز را جارو می‌کند (سقفِ پیش‌هنگام ۶۰ روز است، پس ۱۸۰ حاشیهٔ
سه‌برابری دارد).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-04
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمولِ fail-closed مهاجرت‌های 0002/0005/0006 — نبودِ GUC یعنی صفر ردیف.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def upgrade() -> None:
    # ── ۱) ترجیحاتِ اعلان روی عضو ─────────────────────────────
    op.add_column(
        "members",
        sa.Column(
            "notif_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "members",
        sa.Column(
            "notif_prefs",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    # ── ۲) نادیده‌گرفته‌ها (زیرِ RLS خانواده) ──────────────────
    op.create_table(
        "notification_dismissals",
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
        # شناسهٔ قطعیِ اعلان — مثلِ "event:<uuid>:2026-11-03"
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("member_id", "key", name="uq_dismissal_member_key"),
    )
    op.create_index(
        "ix_notification_dismissals_member_id",
        "notification_dismissals",
        ["member_id"],
    )
    op.create_index(
        "ix_notification_dismissals_family_id",
        "notification_dismissals",
        ["family_id"],
    )
    # مرزِ چند-مستأجریِ دیتابیس — عیناً الگوی 0002/0005/0006.
    op.execute("ALTER TABLE notification_dismissals ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notification_dismissals FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY notification_dismissals_family_isolation "
        "ON notification_dismissals "
        f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS notification_dismissals_family_isolation "
        "ON notification_dismissals"
    )
    op.execute("ALTER TABLE notification_dismissals NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notification_dismissals DISABLE ROW LEVEL SECURITY")
    op.drop_index(
        "ix_notification_dismissals_family_id", table_name="notification_dismissals"
    )
    op.drop_index(
        "ix_notification_dismissals_member_id", table_name="notification_dismissals"
    )
    op.drop_table("notification_dismissals")

    op.drop_column("members", "notif_prefs")
    op.drop_column("members", "notif_enabled")
