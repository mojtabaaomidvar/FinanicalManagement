"""Exercise the server migration helper against disposable baseline databases."""
import importlib.util
from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text

from tests.conftest import BACKEND_DIR, MIGRATION_URL, TEST_URL


@pytest.fixture
def baseline_database():
    name = "inventory_upgrade_" + uuid.uuid4().hex + "_test"
    admin = create_engine(MIGRATION_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    engine = create_engine(MIGRATION_URL.set(database=name))
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    try:
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        cfg.attributes["migration_url"] = MIGRATION_URL.set(database=name).render_as_string(hide_password=False)
        command.upgrade(cfg, "0029")
        with engine.begin() as connection:
            family = connection.execute(text(
                "INSERT INTO families(name,code,budget) VALUES ('release fixture','RELEASE',12345) RETURNING id")).scalar_one()
            connection.exec_driver_sql("ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY")
            connection.execute(text("INSERT INTO inventory_items(family_id,title,quantity,threshold,note) "
                                    "VALUES (:family,'تخم مرغ',2.75,8,'private note')"), {"family": family})
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
    path = Path(__file__).resolve().parents[1] / "deploy/migrate-inventory-release.py"
    spec = importlib.util.spec_from_file_location("release_inventory_helper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_release_migrator_preserves_records_and_is_idempotent(baseline_database, migrator):
    migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == migrator.REVISION
        item = connection.execute(text(
            "SELECT title,quantity,note,category,revision FROM inventory_items"
        )).one()
        assert item.title == "تخم مرغ" and str(item.quantity) == "2.75"
        assert item.note == "private note" and item.category == "refrigerated"
        assert item.revision == 1  # Queued writes against the baseline stay valid.
        assert connection.execute(text(
            "SELECT tgenabled FROM pg_trigger WHERE tgrelid='inventory_items'::regclass "
            "AND tgname='inventory_items_revision'"
        )).scalar_one() == "O"
        assert connection.execute(text("SELECT budget FROM families")).scalar_one() == 12345
        assert connection.execute(text("SELECT count(*) FROM inventory_catalog_proposals")).scalar_one() == 0
        tables = ["families", "inventory_items", "inventory_catalog_proposals"]
        before = migrator.fingerprint(connection, tables)
    migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.connect() as connection:
        assert migrator.fingerprint(connection, tables) == before
    with baseline_database.begin() as connection:
        connection.execute(text("UPDATE inventory_items SET quantity=quantity+1"))
        assert connection.execute(text("SELECT revision FROM inventory_items")).scalar_one() == 2


def test_release_migrator_rolls_back_schema_and_threshold_on_failed_data_check(baseline_database, migrator, monkeypatch):
    original = migrator.fingerprint
    calls = 0

    def mismatch(connection, tables):
        nonlocal calls
        calls += 1
        value = original(connection, tables)
        if calls == 2:
            value["injected_mismatch"] = (1, "not-a-real-record")
        return value

    with monkeypatch.context() as patch:
        patch.setattr(migrator, "fingerprint", mismatch)
        with pytest.raises(RuntimeError, match="entire migration rolled back"):
            migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0029"
        assert str(connection.execute(text("SELECT threshold FROM inventory_items")).scalar_one()) == "8.00"
        assert connection.execute(text("SELECT to_regclass('inventory_catalog_proposals')")).scalar_one() is None
        assert connection.execute(text("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                                       "WHERE oid='inventory_items'::regclass")).scalar_one()
        assert connection.execute(text(
            "SELECT tgenabled FROM pg_trigger WHERE tgrelid='inventory_items'::regclass "
            "AND tgname='inventory_items_revision'"
        )).scalar_one() == "O"
    migrator.migrate(baseline_database, TEST_URL.username)


def test_release_migrator_rejects_unrestricted_app_role(baseline_database, migrator):
    with pytest.raises(RuntimeError, match="unrestricted application role"):
        migrator.migrate(baseline_database, MIGRATION_URL.username)
    with baseline_database.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0029"
