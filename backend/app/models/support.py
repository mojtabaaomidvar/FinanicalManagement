"""Operator sessions and anonymous aggregate error counters. No user content."""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SupportSession(Base):
    __tablename__ = "support_sessions"

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    credential_tag: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class SupportErrorCounter(Base):
    __tablename__ = "support_error_counters"
    __table_args__ = (
        CheckConstraint("kind IN ('login','registration')", name="support_error_kind"),
        CheckConstraint("http_family IN ('client','server')", name="support_error_http_family"),
        CheckConstraint("count > 0", name="support_error_count_positive"),
    )

    hour: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    http_family: Mapped[str] = mapped_column(Text, primary_key=True)
    count: Mapped[int] = mapped_column(BigInteger, nullable=False)
