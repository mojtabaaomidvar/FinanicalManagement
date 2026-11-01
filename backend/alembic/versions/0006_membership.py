"""مرحلهٔ B — مدلِ نقش/سازنده، حالتِ عضویت، درخواستِ پیوستن، و تک‌مصرفه‌کردنِ دعوت.

این مهاجرت **افزایشی و برگشت‌پذیر** است و روی دادهٔ زندهٔ تولید می‌نشیند؛ هیچ ستون
یا جدولِ موجودی حذف/بازمعنا نمی‌شود (Rule 10). چهار تغییر:

۱) `families.created_by` (nullable, FK→members.id, ON DELETE SET NULL).
   مفهومِ **Creator** را از **نقش** جدا می‌کند (§2.4: سازنده و مدیر دو چیزند).
   بک‌فیل = عضوی که همین حالا role='owner' است. nullable می‌ماند تا خانواده‌ای
   بدونِ سازنده قفل نشود (اگر روزی owner حذف شد → SET NULL، نه CASCADE).

۲) `members.membership_state` (ستونِ **جدید**، NOT NULL, server_default 'active',
   CHECK شش‌حالته). چرا ستونِ جدا و نه بازمعناکردنِ `status`؟ چون `status` امروز یعنی
   «مدیر معرفی کرده / خودش ثبت‌نام کرده» و دادهٔ سالمِ موجود است. دو محورِ مستقل:
     - status            = آیا این شخص خودش را ساخته/ثبت کرده؟
     - membership_state  = آیا عضویتش در خانواده فعال است؟ (چرخهٔ §2.5)
   بک‌فیلِ همهٔ اعضای موجود = 'active' (رفتار امروز عیناً حفظ می‌شود).

۳) جدولِ `join_requests` (تازه) با **RLS اجباری** مثلِ الگوی مهاجرت 0002/0005.
   نکتهٔ کلیدی (چرا با RLS شدنی است هرچند پیش‌از‌احراز نوشته می‌شود): جریانِ
   «پذیرش دعوت / پیوستن با کد» زمینهٔ خانواده را از **توکنِ سرور-تأییدشده** (نه از
   ورودیِ کلاینت) صریح روی همان تراکنش می‌گذارد، پس WITH CHECK برقرار می‌ماند و
   INSERT رد نمی‌شود — همان مکانیزمِ set_config('app.family_id', …) لایهٔ rls.py.

۴) `family_invites` تک‌مصرفه: ستون‌های `used_at`/`used_by` افزوده می‌شوند تا پذیرش،
   لینک را «بسوزاند» (رفعِ شکافِ #۳: لینکِ لو‌رفته دیگر بی‌نهایت بار کار نمی‌کند).

⚠️ همان هشدارِ مهاجرت 0002 دربارهٔ FORCE و بارِ data-only اینجا هم برای
   join_requests صادق است؛ ولی این جدول در بارِ فاز ۱۰ خالی است پس بی‌اثر.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# همان محمولِ fail-closed مهاجرت 0002/0005 — نبودِ GUC یعنی صفر ردیف.
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"

_MEMBERSHIP_STATES = ("pending", "active", "rejected", "expired", "suspended", "removed")
_JOIN_STATES = ("pending", "approved", "rejected", "expired")


def upgrade() -> None:
    # ── ۱) Creator روی خانواده ───────────────────────────────
    op.add_column(
        "families",
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # بک‌فیل: سازنده = مدیرِ فعلی (role='owner'). اگر خانواده‌ای owner نداشت → NULL.
    op.execute(
        "UPDATE families f SET created_by = m.id "
        "FROM members m WHERE m.family_id = f.id AND m.role = 'owner'"
    )

    # ── ۲) حالتِ عضویت روی اعضا (محورِ جدا از status) ─────────
    op.add_column(
        "members",
        sa.Column(
            "membership_state",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
    )
    states = ",".join(f"'{s}'" for s in _MEMBERSHIP_STATES)
    op.create_check_constraint(
        "membership_state", "members", f"membership_state IN ({states})"
    )

    # ── ۳) درخواست‌های پیوستن (زیرِ RLS خانواده) ──────────────
    join_states = ",".join(f"'{s}'" for s in _JOIN_STATES)
    op.create_table(
        "join_requests",
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
        # عضوِ متقاضی (پیش از ساخت ممکن است NULL بماند؛ در جریانِ فعلی همیشه ست است).
        sa.Column(
            "member_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # از چه راهی درخواست داد: لینکِ دعوت یا کدِ خانواده.
        sa.Column("via", sa.Text(), nullable=False),
        sa.Column(
            "invite_id",
            UUID(as_uuid=True),
            sa.ForeignKey("family_invites.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "state", sa.Text(), nullable=False, server_default=sa.text("'pending'")
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "decided_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("via IN ('link','code')", name="via"),
        sa.CheckConstraint(f"state IN ({join_states})", name="state"),
    )
    op.create_index("ix_join_requests_family_id", "join_requests", ["family_id"])
    op.create_index("ix_join_requests_member_id", "join_requests", ["member_id"])
    # مرزِ چند-مستأجریِ دیتابیس — عیناً الگوی 0002/0005.
    op.execute("ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE join_requests FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY join_requests_family_isolation ON join_requests "
        f"FOR ALL USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )

    # ── ۴) تک‌مصرفه‌کردنِ دعوت (رفعِ #۳) ──────────────────────
    op.add_column(
        "family_invites",
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "family_invites",
        sa.Column(
            "used_by",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("family_invites", "used_by")
    op.drop_column("family_invites", "used_at")

    op.execute("DROP POLICY IF EXISTS join_requests_family_isolation ON join_requests")
    op.execute("ALTER TABLE join_requests NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE join_requests DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_join_requests_member_id", table_name="join_requests")
    op.drop_index("ix_join_requests_family_id", table_name="join_requests")
    op.drop_table("join_requests")

    op.drop_constraint("membership_state", "members", type_="check")
    op.drop_column("members", "membership_state")

    op.drop_column("families", "created_by")
