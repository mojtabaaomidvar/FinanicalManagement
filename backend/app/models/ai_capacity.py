"""Short-lived operational allowances; never joined to aggregate product reports."""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiDailyAllowance(Base):
    __tablename__ = "ai_daily_allowances"
    __table_args__ = (CheckConstraint("requests > 0", name="ai_allowance_positive"),)

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    scope: Mapped[str] = mapped_column(Text, primary_key=True)
    requests: Mapped[int] = mapped_column(BigInteger, nullable=False)


class AiCapacityLease(Base):
    __tablename__ = "ai_capacity_leases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
