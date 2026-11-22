"""Release preflight uses real SQL through the restricted application role."""
# ruff: noqa: F811 -- pytest resolves these imported fixtures by argument name.
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from tests.conftest import TEST_URL
from tests.test_inventory_release import baseline_database, migrator  # noqa: F401


@pytest.fixture
def checker(baseline_database, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "deploy/check-inventory-release.py"
    spec = importlib.util.spec_from_file_location("release_inventory_checker", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with baseline_database.begin() as connection:
        role = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        connection.exec_driver_sql("GRANT USAGE ON SCHEMA public TO " + role)
        connection.exec_driver_sql("GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + role)
    engine = create_engine(TEST_URL.set(database=baseline_database.url.database))
    import app.db.session

    with monkeypatch.context() as patch:
        patch.setattr(app.db.session, "engine", engine)
        try:
            yield module
        finally:
            engine.dispose()


def test_checker_accepts_baseline_and_migrated_database(checker, baseline_database, migrator):
    assert checker.database_state() == "BASELINE"
    migrator.migrate(baseline_database, TEST_URL.username)
    assert checker.database_state() == "ALREADY"


def test_checker_rejects_disabled_revision_trigger(checker, baseline_database):
    with baseline_database.begin() as connection:
        connection.exec_driver_sql(
            "ALTER TABLE inventory_items DISABLE TRIGGER inventory_items_revision"
        )
    with pytest.raises(SystemExit, match="revision trigger differs"):
        checker.database_state()


def test_checker_rejects_missing_existing_encryption_key(checker, monkeypatch):
    monkeypatch.delenv("DOCUMENT_ENCRYPTION_KEY", raising=False)
    with pytest.raises(SystemExit, match="encryption configuration is missing"):
        checker.database_state()
