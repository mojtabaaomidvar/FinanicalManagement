"""خارج‌کردنِ sms_bridges از RLS — جدولِ «قابلیت/بوت‌استرپ» (فاز ۸)

چرا؟ اندپوینتِ bridge-ingest (جایگزینِ api/sms-webhook.js) با «توکنِ پل» احراز می‌شود،
نه با نشستِ کاربر. برای یافتنِ خانواده باید ابتدا ردیفِ sms_bridges را «با توکن»
بخواند — یعنی «پیش از» داشتنِ زمینهٔ خانواده (app.family_id هنوز خالی است). اما در
0002، جدولِ sms_bridges زیرِ FORCE ROW LEVEL SECURITY بود و محمولِ fail-closed
(`family_id = NULLIF(...)::uuid`) با GUCِ خالی صفر ردیف می‌داد → پل هرگز پیدا نمی‌شد.

راه‌حل (هم‌راستا با تصمیمِ 0002): sms_bridges دقیقاً مثلِ family_invites یک «جدولِ
قابلیت» است که پیش از هر زمینه‌ای با یک رازِ غیرقابل‌حدس (توکنِ ۴۰-هگز، ستونِ unique)
باز می‌شود؛ پس مثلِ family_invites از RLS خارج می‌شود و صرفاً با scopingِ لایهٔ اپ
(فیلترِ member_id/family_id + یکتاییِ توکن) محافظت می‌گردد. جدولِ داده‌ایِ واقعی
(sms_messages) همچنان زیرِ FORCE RLS می‌ماند؛ درجِ پیامک پس از ست‌شدنِ دستیِ زمینهٔ
خانواده (از روی همان پل) انجام می‌شود و همچنان مشمولِ RLS است.

اثر بر مسیرهای موجود: get_bridge/create_bridge (فاز ۷) با زمینهٔ خانواده اجرا می‌شوند؛
با حذفِ RLS، مرزِ خانواده برای این جدول به لایهٔ اپ (که همین حالا هم فیلتر می‌کند)
منتقل می‌شود — بدونِ تغییرِ رفتار.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-08
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "sms_bridges"
_POLICY = f"{_TABLE}_family_isolation"
# همان محمولِ 0002 (برای بازگردانی در downgrade)
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def upgrade() -> None:
    # پل به جدولِ قابلیت تبدیل می‌شود: پالیسی حذف، FORCE برداشته، RLS خاموش.
    op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON {_TABLE}")
    op.execute(f"ALTER TABLE {_TABLE} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLE} DISABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # بازگردانی به وضعیتِ 0002 (RLSِ خانواده‌محور روی sms_bridges).
    op.execute(f"ALTER TABLE {_TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {_POLICY} ON {_TABLE} "
        f"FOR ALL "
        f"USING ({_PREDICATE}) "
        f"WITH CHECK ({_PREDICATE})"
    )
