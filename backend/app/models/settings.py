"""تنظیمات سراسری برنامه — تک‌ردیفی (id=1)."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Boolean, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppSetting(Base):
    __tablename__ = "app_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=False, server_default=text("1")
    )
    dev_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    otp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
