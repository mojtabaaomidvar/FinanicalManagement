"""Programmatic migrations must not silence existing application audit loggers."""
import logging

from alembic import command
from alembic.config import Config

from tests.conftest import BACKEND_DIR, MIGRATION_URL


def test_migrations_keep_existing_application_loggers_enabled(database, monkeypatch):
    names = ["activities", "children", "documents", "goals", "pets", "messaging"]
    loggers = [logging.getLogger("app.services." + name) for name in names]
    for logger in loggers:
        monkeypatch.setattr(logger, "disabled", False)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = MIGRATION_URL.render_as_string(hide_password=False)
    command.upgrade(cfg, "head")
    assert all(not logger.disabled for logger in loggers)
