"""Read-only production preflight exercised through a real restricted DB role."""
# ruff: noqa: F811
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from tests.conftest import TEST_URL
from tests.test_assistant_release import baseline_database, migrator  # noqa: F401


@pytest.fixture
def checker(baseline_database, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'deploy/check-assistant-release.py'
    spec = importlib.util.spec_from_file_location('release_assistant_checker', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with baseline_database.begin() as connection:
        role = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        connection.exec_driver_sql('GRANT USAGE ON SCHEMA public TO ' + role)
        connection.exec_driver_sql('GRANT SELECT ON ALL TABLES IN SCHEMA public TO ' + role)
    engine = create_engine(TEST_URL.set(database=baseline_database.url.database))
    import app.db.session
    with monkeypatch.context() as patch:
        patch.setattr(app.db.session, 'engine', engine)
        patch.setenv('AI_SMS_GATEWAY_URL', 'https://api.khaanehyar.ir/ai-gateway')
        patch.setenv('AI_SMS_GATEWAY_TOKEN', 't' * 43)
        patch.setenv('AI_SMS_MODEL', 'deepseek-flash')
        patch.setenv('DEEPSEEK_API_KEY', '')
        try:
            yield module
        finally:
            engine.dispose()


def test_checker_accepts_official_baseline_and_receipt_migration(
    checker, baseline_database, migrator,
):
    assert checker.database_state() == 'BASELINE'
    migrator.migrate(baseline_database, TEST_URL.username)
    assert checker.database_state() == 'ALREADY'


def test_checker_rejects_disabled_inventory_trigger(checker, baseline_database):
    with baseline_database.begin() as connection:
        connection.exec_driver_sql(
            'ALTER TABLE inventory_items DISABLE TRIGGER inventory_items_revision'
        )
    with pytest.raises(SystemExit, match='revision trigger differs'):
        checker.database_state()


def test_checker_rejects_missing_existing_encryption_key(checker, monkeypatch):
    monkeypatch.delenv('DOCUMENT_ENCRYPTION_KEY', raising=False)
    with pytest.raises(SystemExit, match='encryption configuration is missing'):
        checker.database_state()


def test_checker_rejects_missing_signing_secret(checker, monkeypatch):
    monkeypatch.delenv('FILE_SIGNING_SECRET', raising=False)
    with pytest.raises(SystemExit, match='signing secret required'):
        checker.database_state()


def test_checker_rejects_receipt_rls_disabled(checker, baseline_database, migrator):
    migrator.migrate(baseline_database, TEST_URL.username)
    with baseline_database.begin() as connection:
        connection.exec_driver_sql(
            'ALTER TABLE assistant_execution_receipts DISABLE ROW LEVEL SECURITY'
        )
    with pytest.raises(SystemExit, match='Receipt RLS differs'):
        checker.database_state()


def test_checker_rejects_missing_gateway_connection(
    checker, baseline_database, migrator, monkeypatch,
):
    migrator.migrate(baseline_database, TEST_URL.username)
    monkeypatch.delenv('AI_SMS_GATEWAY_TOKEN', raising=False)
    with pytest.raises(SystemExit, match='private gateway connection'):
        checker.database_state()
