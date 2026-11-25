"""Release-specific atomic migration and exact catalog checks on disposable DBs."""
import importlib.util
import os
import subprocess
from uuid import uuid4
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy import create_engine

from tests.conftest import BACKEND_DIR, TEST_URL, MIGRATION_URL
from tests.test_assistant_release import baseline_database  # noqa: F401


def load(name):
    spec = importlib.util.spec_from_file_location(name, BACKEND_DIR / "deploy" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def release_db(baseline_database):
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = baseline_database.url.render_as_string(hide_password=False)
    command.upgrade(cfg, "0036_payment_method")
    with baseline_database.begin() as connection:
        family = connection.scalar(text("SELECT id FROM families"))
        member = connection.scalar(text("INSERT INTO members(family_id,name,role) VALUES (:family,'fixture owner','owner') RETURNING id"), {"family": family})
        account = connection.scalar(text("INSERT INTO accounts(family_id,member_id,title,initial_balance) VALUES (:family,:member,'fixture wallet',1499.9) RETURNING id"), {"family": family, "member": member})
        connection.execute(text("INSERT INTO transactions(family_id,member_id,type,amount,category,date,account_id) "
                                "VALUES (:family,:member,'expense',0.01,'food','2026-10-01',:account)"),
                           {"family": family, "member": member, "account": account})
    return baseline_database


@pytest.fixture
def migration():
    return load("migrate-wallet-release")


@pytest.fixture
def contract(release_db, migration):
    checker = migration.checker
    with release_db.connect() as connection:
        baseline = checker.schema_digest(connection)
        connection.rollback()
        transaction = connection.begin()
        try:
            spec = importlib.util.spec_from_file_location("trusted_wallet_migration", BACKEND_DIR / "alembic/versions/0037_wallet_corrections.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            incoming = checker.schema_digest(connection)
        finally:
            transaction.rollback()
    return {"schema_sha256": {checker.BASELINE: baseline, checker.REVISION: incoming}}


def test_release_preserves_every_historical_row_and_repeats_without_reset(release_db, migration, contract):
    with release_db.connect() as connection:
        names = migration.tables(connection)
        before = migration.fingerprint(connection, names)
    migration.migrate(release_db, TEST_URL.username, contract)
    migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.connect() as connection:
        assert migration.fingerprint(connection, names) == before
        assert migration.checker.schema_state(connection, contract, TEST_URL.username) == "0037_wallet_corrections"
        assert connection.scalar(text("SELECT count(*) FROM wallet_corrections")) == 0
        assert connection.scalar(text("SELECT amount::text FROM transactions")) == "0.01"
        assert connection.scalar(text("SELECT initial_balance::text FROM accounts")) == "1499.9"


def test_history_mismatch_rolls_back_schema_revision_and_grants(release_db, migration, contract, monkeypatch):
    original = migration.fingerprint
    calls = 0
    def mismatch(connection, names):
        nonlocal calls
        calls += 1
        value = original(connection, names)
        if calls == 2:
            value["injected"] = (1, "mismatch")
        return value
    monkeypatch.setattr(migration, "fingerprint", mismatch)
    with pytest.raises(RuntimeError, match="entire migration rolled back"):
        migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0036_payment_method"
        assert connection.scalar(text("SELECT to_regclass('public.wallet_corrections')")) is None
        assert migration.checker.schema_digest(connection) == contract["schema_sha256"]["0036_payment_method"]


def test_restricted_app_role_is_required(release_db, migration, contract):
    with pytest.raises(RuntimeError, match="Unrestricted application role"):
        migration.migrate(release_db, MIGRATION_URL.username, contract)


@pytest.mark.parametrize("change", [
    "ALTER TABLE transactions NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE accounts ADD COLUMN unexpected_wallet_column text",
    "UPDATE alembic_version SET version_num='unknown'",
])
def test_unknown_baseline_or_security_drift_refused(release_db, migration, contract, change):
    with release_db.begin() as connection:
        connection.exec_driver_sql(change)
    with pytest.raises(RuntimeError, match="differs|Expected exact"):
        migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.connect() as connection:
        assert connection.scalar(text("SELECT to_regclass('public.wallet_corrections')")) is None


@pytest.mark.parametrize("change", [
    "ALTER TABLE wallet_corrections NO FORCE ROW LEVEL SECURITY",
    "DROP TRIGGER wallet_tx_revision ON transactions",
    "ALTER FUNCTION public.wallet_ledger_balance(uuid,uuid) SET search_path=public",
    "GRANT EXECUTE ON FUNCTION public.wallet_ledger_balance(uuid,uuid) TO PUBLIC",
    "REVOKE EXECUTE ON FUNCTION public.wallet_account_has_transactions(uuid) FROM wallet_test_app",
    "GRANT UPDATE ON wallet_corrections TO wallet_test_app",
])
def test_completed_install_drift_cannot_be_misreported_as_success(release_db, migration, contract, change):
    migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.begin() as connection:
        connection.exec_driver_sql(change)
    with pytest.raises(RuntimeError, match="differ|missing"):
        migration.migrate(release_db, TEST_URL.username, contract)


def test_repeat_preserves_new_revisions_instead_of_zeroing_accounts(release_db, migration, contract):
    migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.begin() as connection:
        connection.exec_driver_sql("UPDATE accounts SET initial_balance=initial_balance+0.1")
    migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.connect() as connection:
        assert connection.scalar(text("SELECT balance_revision FROM accounts")) == 1


def test_backup_fingerprint_includes_revisions_after_activation(release_db, migration, contract):
    migration.migrate(release_db, TEST_URL.username, contract)
    with release_db.connect() as connection:
        names = migration.tables(connection)
        initial = migration.fingerprint(connection, names, omit_new_revision=False)
    with release_db.begin() as connection:
        connection.exec_driver_sql("UPDATE accounts SET balance_revision=balance_revision+1")
    with release_db.connect() as connection:
        assert migration.fingerprint(connection, names, omit_new_revision=False) != initial


@pytest.mark.parametrize("tamper", [None, "amount", "revision", "schema"])
def test_actual_pg_dump_restore_is_verified_without_touching_live_database(release_db, migration, contract, monkeypatch, tamper):
    pg_bin = os.environ.get("WALLET_TEST_PG_BIN")
    if not pg_bin:
        pytest.skip("Set WALLET_TEST_PG_BIN for the local PostgreSQL backup/restore acceptance")
    migration.migrate(release_db, TEST_URL.username, contract)
    checker = load("verify-wallet-backup")
    name = "khaneyar_wallet_restore_" + str(uuid4().int)
    admin = create_engine(MIGRATION_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    restored = create_engine(MIGRATION_URL.set(database=name))
    env = {**os.environ, "PGHOST": MIGRATION_URL.host, "PGPORT": str(MIGRATION_URL.port),
           "PGUSER": MIGRATION_URL.username, "PGPASSWORD": MIGRATION_URL.password or ""}
    suffix = ".exe" if os.name == "nt" else ""
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}" TEMPLATE template0')
    try:
        dump = subprocess.run([str(Path(pg_bin) / ("pg_dump" + suffix)), "-d", release_db.url.database],
                              env=env, capture_output=True, check=True).stdout
        subprocess.run([str(Path(pg_bin) / ("psql" + suffix)), "-v", "ON_ERROR_STOP=1", "-d", name],
                       env=env, input=dump, capture_output=True, check=True)
        if tamper:
            with restored.begin() as connection:
                change = {"amount": "UPDATE accounts SET initial_balance=initial_balance+0.1",
                          "revision": "UPDATE accounts SET balance_revision=balance_revision+1",
                          "schema": "ALTER TABLE wallet_corrections NO FORCE ROW LEVEL SECURITY"}[tamper]
                connection.exec_driver_sql(change)
        monkeypatch.setattr(checker.module.checker, "database_engine", lambda: (release_db, TEST_URL.username))
        if tamper:
            with pytest.raises(RuntimeError, match="Restored database differs"):
                checker.verify(name)
        else:
            checker.verify(name)
        with release_db.connect() as connection:
            assert connection.scalar(text("SELECT balance_revision FROM accounts")) == 0
            assert connection.scalar(text("SELECT count(*) FROM wallet_corrections")) == 0
    finally:
        restored.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


@pytest.mark.parametrize("has_receipt", [False, True])
def test_old_api_rollback_requires_empty_real_wallet_history(release_db, migration, contract, monkeypatch, has_receipt):
    migration.migrate(release_db, TEST_URL.username, contract)
    checker = migration.checker
    for key, value in {"DOCUMENT_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                       "FILE_SIGNING_SECRET": "release-test-only", "AI_SMS_GATEWAY_URL": "https://api.khaanehyar.ir/ai-gateway",
                       "AI_SMS_GATEWAY_TOKEN": "fictional-test-token", "AI_SMS_MODEL": "deepseek-flash", "DEEPSEEK_API_KEY": ""}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(checker, "database_engine", lambda: (release_db, TEST_URL.username))
    if has_receipt:
        with release_db.begin() as connection:
            family, member, account = connection.execute(text("SELECT family_id,member_id,id FROM accounts")).one()
            connection.execute(text("SELECT set_config('app.family_id',:family,true),set_config('app.document_member_id',:member,true)"),
                               {"family": str(family), "member": str(member)})
            connection.execute(text("INSERT INTO wallet_corrections(family_id,account_id,created_by,operation_id,request_hash,"
                                    "mode,revision,target_balance,ledger_before,current_before,ledger_after,current_after,delta) "
                                    "VALUES (:family,:account,:member,:operation,:hash,'reconciliation',1,1499.90,1499.89,1499.89,1499.89,1499.90,0.01)"),
                               {"family": family, "account": account, "member": member, "operation": uuid4(), "hash": "a" * 64})
        with pytest.raises(RuntimeError, match="audit history exists"):
            checker.database_state(contract, rollback=True)
        with release_db.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM wallet_corrections")) == 1
            assert connection.scalar(text("SELECT balance_revision FROM accounts")) == 1
    else:
        assert checker.database_state(contract, rollback=True) == "ALREADY"
