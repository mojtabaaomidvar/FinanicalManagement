"""Verify the official lineage, rollback and data-preserving receipt migration."""
import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text

from alembic import command
from tests.conftest import BACKEND_DIR, MIGRATION_URL, TEST_URL


@pytest.fixture
def baseline_database():
    name = "assistant_upgrade_" + uuid.uuid4().hex + "_test"
    admin = create_engine(MIGRATION_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    engine = create_engine(MIGRATION_URL.set(database=name))
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    try:
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        cfg.attributes["migration_url"] = MIGRATION_URL.set(database=name).render_as_string(
            hide_password=False
        )
        command.upgrade(cfg, "0033_inventory_categories")
        with engine.begin() as connection:
            family = connection.execute(text(
                "INSERT INTO families(name,code,budget) "
                "VALUES ('release fixture','RELEASE',12345) RETURNING id"
            )).scalar_one()
            connection.exec_driver_sql("ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY")
            connection.execute(text(
                "INSERT INTO inventory_items(family_id,title,quantity,note,category) "
                "VALUES (:family,'نان',0,'private note','bread')"
            ), {"family": family})
            connection.exec_driver_sql("ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY")
            connection.exec_driver_sql("ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY")
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


@pytest.fixture
def migrator():
    path = Path(__file__).resolve().parents[1] / "deploy/migrate-assistant-release.py"
    spec = importlib.util.spec_from_file_location("release_assistant_helper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_release_migrator_preserves_all_existing_records_and_replays(baseline_database, migrator):
    with baseline_database.connect() as connection:
        tables = connection.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename <> 'alembic_version' ORDER BY tablename"
        )).scalars().all()
        before = migrator.fingerprint(connection, tables)
    migrator.migrate(baseline_database, TEST_URL.username)
    migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.connect() as connection:
        assert migrator.fingerprint(connection, tables) == before
        assert connection.execute(text(
            "SELECT version_num FROM alembic_version"
        )).scalar_one() == migrator.REVISION
        assert connection.execute(text(
            "SELECT count(*) FROM assistant_execution_receipts"
        )).scalar_one() == 0


def test_release_migrator_rolls_back_receipt_table_on_failed_data_check(
    baseline_database, migrator, monkeypatch,
):
    original = migrator.fingerprint
    calls = 0
    def mismatch(connection, tables):
        nonlocal calls
        calls += 1
        value = original(connection, tables)
        if calls == 2:
            value['injected'] = (1, 'mismatch')
        return value
    with monkeypatch.context() as patch:
        patch.setattr(migrator, 'fingerprint', mismatch)
        with pytest.raises(RuntimeError, match='entire migration rolled back'):
            migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.connect() as connection:
        assert connection.execute(text(
            "SELECT version_num FROM alembic_version"
        )).scalar_one() == migrator.BASELINE
        assert connection.execute(text(
            "SELECT to_regclass('assistant_execution_receipts')"
        )).scalar_one() is None


def test_release_migrator_rejects_unrestricted_application_role(baseline_database, migrator):
    with pytest.raises(RuntimeError, match='unrestricted application role'):
        migrator.migrate(baseline_database, MIGRATION_URL.username)
