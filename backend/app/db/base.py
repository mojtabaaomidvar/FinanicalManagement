"""پایهٔ SQLAlchemy + قرارداد نام‌گذاری قیدها.

قرارداد نام‌گذاری باعث می‌شود نام ایندکس/کلید خارجی/قید یکنواخت و پایدار بماند
تا مهاجرت‌های Alembic قابل‌پیش‌بینی باشند.
"""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
