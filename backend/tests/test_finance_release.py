"""Exact-source release preflight and historical-preserving installer migration."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from tests.conftest import BACKEND_DIR, MIGRATION_URL, TEST_URL
from tests.test_assistant_release import baseline_database  # noqa: F401


def load(name):
    spec = importlib.util.spec_from_file_location(name, BACKEND_DIR / "deploy" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def finance_database(baseline_database):
    engine = baseline_database
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = engine.url.render_as_string(hide_password=False)
    command.upgrade(cfg, "0034_assistant_receipts")
    with engine.begin() as connection:
        family = connection.execute(text("SELECT id FROM families")).scalar_one()
        member = connection.execute(text(
            "INSERT INTO members(family_id,name,role) VALUES (:family,'historical owner','owner') RETURNING id"
        ), {"family": family}).scalar_one()
        connection.execute(text(
            "INSERT INTO transactions(family_id,member_id,type,amount,category,date,time,note) "
            "VALUES (:family,:member,'expense',1234.5,'food','2026-10-01','12:34:56','untouched original note')"
        ), {"family": family, "member": member})
        for status in ["pending", "recorded", "ignored"]:
            connection.execute(text(
                "INSERT INTO sms_messages(family_id,member_id,raw_text,bank,type,amount,date,status) "
                "VALUES (:family,:member,'historical raw SMS','historical bank','expense',12345,'2026-10-01',:status)"
            ), {"family": family, "member": member, "status": status})
        role = connection.dialect.identifier_preparer.quote(TEST_URL.username)
        connection.exec_driver_sql("GRANT USAGE ON SCHEMA public TO " + role)
        connection.exec_driver_sql("GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + role)
    return engine


@pytest.fixture
def migrator():
    return load("migrate-finance-release")


@pytest.fixture
def checker(finance_database, monkeypatch):
    module = load("check-finance-release")
    engine = create_engine(TEST_URL.set(database=finance_database.url.database))
    import app.db.session
    monkeypatch.setattr(app.db.session, "engine", engine)
    monkeypatch.setenv("AI_SMS_GATEWAY_URL", "https://api.khaanehyar.ir/ai-gateway")
    monkeypatch.setenv("AI_SMS_GATEWAY_TOKEN", "t" * 43)
    monkeypatch.setenv("AI_SMS_MODEL", "deepseek-flash")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    try:
        yield module
    finally:
        engine.dispose()


def tables(connection):
    return connection.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' "
        "AND tablename <> 'alembic_version' ORDER BY tablename"
    )).scalars().all()


def test_atomic_release_migration_preserves_history_null_values_rls_and_replay(finance_database, migrator, checker):
    with finance_database.connect() as connection:
        names = tables(connection)
        before = migrator.fingerprint(connection, names)
    assert checker.database_state() == "BASELINE"
    migrator.migrate(finance_database, TEST_URL.username)
    migrator.migrate(finance_database, TEST_URL.username)
    assert checker.database_state() == "ALREADY"
    with finance_database.connect() as connection:
        assert tables(connection) == names
        assert migrator.fingerprint(connection, names) == before
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == migrator.REVISION
        for table, columns in migrator.NEW_COLUMNS.items():
            for name in columns:
                assert connection.exec_driver_sql(f'SELECT count(*) FROM {table} WHERE "{name}" IS NOT NULL').scalar_one() == 0


def test_failed_history_check_rolls_back_both_migrations(finance_database, migrator, monkeypatch):
    original = migrator.fingerprint
    calls = 0
    def mismatch(connection, names):
        nonlocal calls
        calls += 1
        value = original(connection, names)
        if calls == 2:
            value["injected"] = (1, "changed")
        return value
    monkeypatch.setattr(migrator, "fingerprint", mismatch)
    with pytest.raises(RuntimeError, match="entire migration rolled back"):
        migrator.migrate(finance_database, TEST_URL.username)
    with finance_database.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == migrator.BASELINE
        migrator.schema_state(connection, migrator.BASELINE)


def test_installer_rejects_unrestricted_role(finance_database, migrator):
    with pytest.raises(RuntimeError, match="Unrestricted application role"):
        migrator.migrate(finance_database, MIGRATION_URL.username)


@pytest.mark.parametrize("revision", ["0033_inventory_categories", "0035_sms_integrity", "unknown"])
def test_installer_rejects_nonofficial_or_partial_revision(finance_database, migrator, checker, revision):
    with finance_database.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num=:revision"), {"revision": revision})
    with pytest.raises(RuntimeError, match="exact 0.8.0"):
        migrator.migrate(finance_database, TEST_URL.username)
    with pytest.raises(SystemExit, match="exact 0.8.0"):
        checker.database_state()


def test_installer_rejects_unexpected_baseline_columns(finance_database, migrator, checker):
    with finance_database.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE transactions ADD COLUMN payment_method text")
    with pytest.raises(RuntimeError, match="unexpected financial columns"):
        migrator.migrate(finance_database, TEST_URL.username)
    with pytest.raises(SystemExit, match="schema differs"):
        checker.database_state()


@pytest.mark.parametrize("change", ["ALTER TABLE transactions DISABLE ROW LEVEL SECURITY",
    "ALTER TABLE sms_messages NO FORCE ROW LEVEL SECURITY", "DROP INDEX sms_identity_unique",
    "ALTER TABLE transactions DROP CONSTRAINT transaction_payment_fee"])
def test_checker_rejects_changed_financial_security(finance_database, migrator, checker, change):
    migrator.migrate(finance_database, TEST_URL.username)
    with finance_database.begin() as connection:
        connection.exec_driver_sql(change)
    with pytest.raises(SystemExit, match="differ"):
        checker.database_state()
    with pytest.raises(RuntimeError, match="differs|missing"):
        migrator.migrate(finance_database, TEST_URL.username)


@pytest.mark.parametrize("setting", ["DOCUMENT_ENCRYPTION_KEY", "FILE_SIGNING_SECRET", "AI_SMS_GATEWAY_TOKEN"])
def test_checker_requires_existing_private_settings(checker, monkeypatch, setting):
    monkeypatch.delenv(setting)
    with pytest.raises(SystemExit, match="required|connection"):
        checker.database_state()


def fixture_manifest(root):
    value = {"tag": "v0.9.0", "software_version": "0.9.0", "baseline_tag": "v0.8.0",
        "deployment_scope": "api-pwa-only", "database_baseline_revision": "0034_assistant_receipts",
        "database_revision": "0036_payment_method", "database_migration_required": True}
    for relative, key in [("pwa", "pwa_sha256"), ("source/backend/app", "backend_app_sha256"),
                          ("source/backend/alembic", "alembic_sha256")]:
        path = root / relative
        path.mkdir(parents=True)
        (path / "sample.txt").write_text("verified")
        value[key] = {"sample.txt": hashlib.sha256(b"verified").hexdigest()}
    metadata = json.dumps({"version": "0.9.0"}).encode()
    (root / "pwa/version.json").write_bytes(metadata)
    value["pwa_sha256"]["version.json"] = hashlib.sha256(metadata).hexdigest()
    value["backend_launch_sha256"] = {}
    (root / "validation.json").write_text(json.dumps(value))
    return value


def test_incoming_preflight_checks_actual_files_and_metadata(tmp_path, monkeypatch, capsys):
    checker = load("check-finance-release")
    fixture_manifest(tmp_path)
    monkeypatch.setattr(checker.sys, "argv", ["checker.py", "incoming", str(tmp_path)])
    checker.main()
    assert capsys.readouterr().out.strip() == "VERIFIED"
    (tmp_path / "pwa/sample.txt").write_text("tampered")
    with pytest.raises(SystemExit, match="checksum mismatch"):
        checker.main()


@pytest.mark.parametrize("mutation", ["extra", "missing", "wrong-version", "wrong-baseline"])
def test_incoming_preflight_rejects_unverified_release(tmp_path, monkeypatch, mutation):
    checker = load("check-finance-release")
    manifest = fixture_manifest(tmp_path)
    if mutation == "extra":
        (tmp_path / "source/backend/app/extra.txt").write_text("unknown")
    elif mutation == "missing":
        (tmp_path / "source/backend/alembic/sample.txt").unlink()
    else:
        manifest["software_version" if mutation == "wrong-version" else "baseline_tag"] = "unknown"
        (tmp_path / "validation.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(checker.sys, "argv", ["checker.py", "incoming", str(tmp_path)])
    with pytest.raises(SystemExit):
        checker.main()


@pytest.mark.parametrize("migrated", [False, True])
def test_old_api_rollback_contract_accepts_only_verified_source_schema(finance_database, migrator, checker, tmp_path, monkeypatch, capsys, migrated):
    if migrated:
        migrator.migrate(finance_database, TEST_URL.username)
    capsys.readouterr()
    for name in ["app", "alembic"]:
        (tmp_path / name).mkdir()
        (tmp_path / name / "sample.txt").write_text("verified")
    hashes = {"sample.txt": hashlib.sha256(b"verified").hexdigest()}
    contract = {"incoming": {"other": "unknown"}, "baseline": hashes,
                "alembic": {"other": "unknown"}, "baseline_alembic": hashes}
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(checker.sys, "argv", ["checker.py", "rollback", json.dumps(contract)])
    checker.main()
    assert capsys.readouterr().out.strip() == "ROLLBACK_VERIFIED"
    (tmp_path / "app/sample.txt").write_text("unknown")
    with pytest.raises(SystemExit, match="not a verified financial release"):
        checker.main()
