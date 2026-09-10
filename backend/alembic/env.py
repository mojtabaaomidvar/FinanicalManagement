"""محیط اجرای Alembic.

نشانی دیتابیس از app.core.config.settings خوانده می‌شود (نه از alembic.ini)،
و متادیتای هدف از Base.metadata است؛ با import ماژول app.models همهٔ جدول‌ها ثبت می‌شوند.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base

# ثبت همهٔ مدل‌ها روی Base.metadata (ضروری برای autogenerate)
import app.models  # noqa: F401,E402

config = context.config

# تزریق نشانی دیتابیس از تنظیمات برنامه
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """اجرا در حالت offline — فقط SQL تولید می‌کند (بدون اتصال)."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """اجرا با اتصال زنده به دیتابیس."""
    section = config.get_section(config.config_ini_section, {})
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
