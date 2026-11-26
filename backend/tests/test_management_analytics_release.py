"""Exercise the actual release migrations only in the runner's disposable PostgreSQL."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from tests.conftest import MIGRATION_URL, TEST_URL, create_household, grant_test_application_access, make_transaction

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("analytics_container", ROOT / "deploy/management/analytics-container.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


@pytest.fixture
def baseline(database, client):
    actor = create_household(client)
    make_transaction(client, actor)
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    cfg.attributes["migration_url"] = MIGRATION_URL.render_as_string(hide_password=False)
    command.downgrade(cfg, release.BASELINE)
    try:
        yield database
    finally:
        command.upgrade(cfg, "head")
        grant_test_application_access(database)


def snapshot(engine):
    with engine.connect() as connection:
        names = connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' "
                                        "AND tablename<>'alembic_version' ORDER BY tablename")).scalars().all()
        return release.fingerprint(connection, names), release.catalog(connection, names)


def test_upgrade_preserves_real_schema_and_rows_and_is_idempotent(baseline):
    before, schema = snapshot(baseline)
    assert release.migrate(baseline, TEST_URL.username, ROOT) == "MIGRATED"
    with baseline.connect() as connection:
        assert release.fingerprint(connection, before) == before
        assert release.catalog(connection, before) == schema
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0039"
        release.verify_grants(connection, TEST_URL.username)
        for name in release.NEW_TABLES:
            assert connection.scalar(text("SELECT count(*) FROM " + name)) == 0
    assert release.migrate(baseline, TEST_URL.username, ROOT) == "ALREADY"


def test_failure_between_migrations_rolls_back_everything(baseline):
    before = snapshot(baseline)
    def interrupt(revision):
        if revision == "0038":
            raise RuntimeError("injected interruption")
    with pytest.raises(RuntimeError, match="injected"):
        release.migrate(baseline, TEST_URL.username, ROOT, after_step=interrupt)
    assert snapshot(baseline) == before
    with baseline.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == release.BASELINE
        assert connection.scalar(text("SELECT to_regclass('support_ai_counters')")) is None
    assert release.migrate(baseline, TEST_URL.username, ROOT) == "MIGRATED"


def test_partial_schema_is_not_overwritten(baseline):
    with baseline.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE support_ai_counters (retained text)")
        connection.exec_driver_sql("INSERT INTO support_ai_counters VALUES ('preserve-existing-data')")
    try:
        with pytest.raises(ValueError, match="Partial"):
            release.migrate(baseline, TEST_URL.username, ROOT)
        with baseline.connect() as connection:
            assert connection.scalar(text("SELECT retained FROM support_ai_counters")) == "preserve-existing-data"
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == release.BASELINE
    finally:
        with baseline.begin() as connection:
            connection.exec_driver_sql("DROP TABLE support_ai_counters")


def test_completed_upgrade_rejects_extra_app_privileges(baseline):
    release.migrate(baseline, TEST_URL.username, ROOT)
    with baseline.begin() as connection:
        quoted = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        connection.exec_driver_sql("GRANT TRUNCATE ON support_ai_counters TO " + quoted)
    with pytest.raises(ValueError, match="privileges"):
        release.migrate(baseline, TEST_URL.username, ROOT)
