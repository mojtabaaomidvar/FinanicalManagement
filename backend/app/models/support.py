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


class SupportUsageCounter(Base):
    __tablename__ = "support_usage_counters"
    __table_args__ = (
        CheckConstraint("module IN ('dashboard','transactions','accounts','budgets','bills','reports','calendar','shopping','inventory','tasks','documents','meals','equipment','vehicles','goals','activities','children','pets','market','settings','notifications')", name="support_usage_module"),
        CheckConstraint("action IN ('open','create','update','complete','delete')", name="support_usage_action"),
        CheckConstraint("count > 0", name="support_usage_positive"),
    )
    hour: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    module: Mapped[str] = mapped_column(Text, primary_key=True)
    action: Mapped[str] = mapped_column(Text, primary_key=True)
    count: Mapped[int] = mapped_column(BigInteger, nullable=False)


class SupportAiCounter(Base):
    """Aggregate AI calls only; no family, member, prompt or response data."""

    __tablename__ = "support_ai_counters"
    __table_args__ = (
        CheckConstraint(
            "stage IN ('sms','assistant_analyze','assistant_plan','assistant_report')",
            name="support_ai_stage",
        ),
        CheckConstraint("status IN ('success','failure')", name="support_ai_status"),
        CheckConstraint("requests > 0", name="support_ai_requests_positive"),
        CheckConstraint("input_tokens >= 0", name="support_ai_input_tokens_nonnegative"),
        CheckConstraint("output_tokens >= 0", name="support_ai_output_tokens_nonnegative"),
        CheckConstraint("input_token_requests >= 0 AND input_token_requests <= requests", name="support_ai_input_requests_valid"),
        CheckConstraint("output_token_requests >= 0 AND output_token_requests <= requests", name="support_ai_output_requests_valid"),
    )

    hour: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    stage: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text, primary_key=True)
    requests: Mapped[int] = mapped_column(BigInteger, nullable=False)
    input_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    output_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    input_token_requests: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    output_token_requests: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
