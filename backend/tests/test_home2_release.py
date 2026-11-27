"""Rehearse the actual installed management schema to Home 2 upgrade."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from tests.conftest import MIGRATION_URL, TEST_URL, create_household, grant_test_application_access, make_transaction

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("home2_release", ROOT / "deploy/home2-container.py")
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
    with database.begin() as connection:
        quoted = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        for name, privileges in release.analytics.GRANTS.items():
            connection.exec_driver_sql("REVOKE ALL ON public." + name + " FROM PUBLIC")
            connection.exec_driver_sql("REVOKE ALL ON public." + name + " FROM " + quoted)
            connection.exec_driver_sql("GRANT " + ",".join(sorted(privileges)) + " ON public." + name + " TO " + quoted)
    try:
        yield database
    finally:
        command.upgrade(cfg, "head")
        grant_test_application_access(database)


def snapshot(engine):
    with engine.connect() as connection:
        names = connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' "
                                        "AND tablename<>'alembic_version' ORDER BY tablename")).scalars().all()
        return release.fingerprint(connection, names), release.retained_catalog(connection, names)


def test_upgrade_from_installed_management_preserves_rows_and_is_idempotent(baseline):
    before, schema = snapshot(baseline)
    assert release.migrate(baseline, TEST_URL.username, ROOT) == "MIGRATED"
    with baseline.connect() as connection:
        assert release.fingerprint(connection, before) == before
        assert release.retained_catalog(connection, before) == schema
        assert release.verify_database(connection, TEST_URL.username) == release.REVISION
    assert release.migrate(baseline, TEST_URL.username, ROOT) == "ALREADY"


@pytest.mark.parametrize("step", ["0040_inventory_catalog", "0041_household_changes", release.REVISION])
def test_failure_at_each_step_rolls_back_whole_upgrade(baseline, step):
    before = snapshot(baseline)
    def interrupt(revision):
        if revision == step:
            raise RuntimeError("injected interruption")
    with pytest.raises(RuntimeError, match="injected"):
        release.migrate(baseline, TEST_URL.username, ROOT, after_step=interrupt)
    assert snapshot(baseline) == before
    with baseline.connect() as connection:
        assert release.verify_database(connection, TEST_URL.username) == release.BASELINE


def test_partial_home_schema_is_preserved_and_rejected(baseline):
    with baseline.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE inventory_catalog_entries (retained text)")
        connection.exec_driver_sql("INSERT INTO inventory_catalog_entries VALUES ('preserve')")
    try:
        with pytest.raises(ValueError, match="Partial"):
            release.migrate(baseline, TEST_URL.username, ROOT)
        with baseline.connect() as connection:
            assert connection.scalar(text("SELECT retained FROM inventory_catalog_entries")) == "preserve"
    finally:
        with baseline.begin() as connection:
            connection.exec_driver_sql("DROP TABLE inventory_catalog_entries")


def test_completed_upgrade_rejects_excess_catalog_privileges(baseline):
    release.migrate(baseline, TEST_URL.username, ROOT)
    with baseline.begin() as connection:
        quoted = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        connection.exec_driver_sql("GRANT DELETE ON inventory_catalog_entries TO " + quoted)
    with pytest.raises(ValueError, match="privileges"):
        release.migrate(baseline, TEST_URL.username, ROOT)
