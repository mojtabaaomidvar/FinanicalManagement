"""درخواستِ پیوستن به خانواده (§2.6) — زیرِ RLS خانواده (مهاجرت 0006).

جریان: کد/لینکِ معتبر → ساختِ عضوِ pending + یک ردیفِ join_request با state='pending'
(بدونِ نشست) → تأییدِ مدیر → membership_state='active' + state='approved'.

این جدول برخلافِ family_invites/members (جدول‌های بوت‌استرپِ هویت) **زیرِ RLS** است؛
نوشتنِ پیش‌از‌احرازش با ست‌کردنِ صریحِ زمینهٔ خانواده از توکنِ سرور-تأییدشده ممکن می‌شود.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JoinRequest(Base):
    __tablename__ = "join_requests"
    __table_args__ = (
        CheckConstraint("via IN ('link','code')", name="via"),
        CheckConstraint(
            "state IN ('pending','approved','rejected','expired')", name="state"
        ),
        Index("ix_join_requests_family_id", "family_id"),
        Index("ix_join_requests_member_id", "member_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE")
    )
    via: Mapped[str] = mapped_column(Text, nullable=False)
    invite_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("family_invites.id", ondelete="SET NULL")
    )
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
