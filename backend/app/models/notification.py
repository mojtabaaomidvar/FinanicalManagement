"""§۷ — «نادیده گرفتم»ِ اعلان.

اعلان‌ها خودشان ذخیره **نمی‌شوند**: مشتق‌شده‌اند (یادداشتِ تاریخ‌دارِ زیرِ §7.1
در `docs/master-prompt.md`). از سه منبعِ فعالِ امروز دو تا خودپاک‌کن‌اند —
سررسیدِ تکرارشونده با رسیدگی می‌رود و درخواستِ عضویت با تأیید/رد. تنها رویدادِ
کنش‌ناپذیر (تولد) جایی برای رفتن ندارد، پس همین یک چیز ماندگار می‌شود.

این جدول **زیرِ RLS** است. پس هر مسیری که آن را بخواند یا بنویسد — حتی
مسیری که به‌نظر دربارهٔ چیزِ دیگری است، مثلِ `GET /notifications/prefs` که
فهرستِ نادیده‌گرفته‌ها را هم در پاسخش دارد — باید `get_tenant_member` بگیرد.
معیار «این مفهوم در کدام جدول است» نیست، «این درخواست به کدام جدول‌ها دست
می‌زند» است. بی‌بستنِ GUC، محمولِ fail-closed صفر ردیف می‌دهد و فهرست بی هیچ
خطایی خالی برمی‌گردد.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationDismissal(Base):
    __tablename__ = "notification_dismissals"
    # member_id در کلیدِ یکتا هست چون نادیده‌گرفتنِ یادآورِ تولد توسطِ یک عضو
    # نباید آن را برای بقیهٔ خانواده هم خفه کند.
    __table_args__ = (
        UniqueConstraint("member_id", "key", name="uq_dismissal_member_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # نه برای کوئری — محمولِ RLS این مخزن روی همین ستون بسته می‌شود.
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # شناسهٔ قطعیِ اعلان — مثلِ "event:<uuid>:2026-11-03". تاریخ عمداً درونِ
    # کلید است: هم‌گام‌سازیِ تولد همان ردیفِ رویداد را سرِ جا به سالِ بعد
    # به‌روز می‌کند، پس اگر کلید فقط id بود «نادیده گرفتم»ِ امسال تولدِ همهٔ
    # سال‌های بعد را هم برای همیشه خفه می‌کرد.
    key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
