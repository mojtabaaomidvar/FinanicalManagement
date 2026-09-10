"""موتور و نشست SQLAlchemy (همگام).

مقیاس این اپ (مالی خانوادگی) با حالت همگام کاملاً پاسخ‌گوست و ساده‌تر است.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,   # اتصال‌های مرده را قبل از استفاده تشخیص بده
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def get_db() -> Iterator[Session]:
    """وابستگی FastAPI: یک نشست دیتابیس به‌ازای هر درخواست."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
