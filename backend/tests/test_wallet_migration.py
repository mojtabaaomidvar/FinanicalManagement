"""Migration lifecycle checks on the explicitly disposable PostgreSQL test DB."""
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError

from tests.conftest import BACKEND_DIR, MIGRATION_URL, grant_test_application_access
from tests.test_wallet_corrections import wallet, correct, balance, history


def config():
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = MIGRATION_URL.render_as_string(hide_password=False)
    return cfg


def test_empty_wallet_migration_downgrades_and_reupgrades_without_dangling_functions(database):
    cfg = config()
    try:
        command.downgrade(cfg, "0036_payment_method")
        schema = inspect(database)
        assert "wallet_corrections" not in schema.get_table_names()
        assert "balance_revision" not in {column["name"] for column in schema.get_columns("accounts")}
        with database.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'wallet_%'")) == 0
    finally:
        command.upgrade(cfg, "head")
        grant_test_application_access(database)
    assert "wallet_corrections" in inspect(database).get_table_names()


def test_wallet_downgrade_refuses_to_discard_existing_audit_history(client, home_a, database):
    account = wallet(client, home_a, "1000")
    assert correct(client, home_a, account, "900")[0].status_code == 201
    before = balance(client, home_a, account)
    receipts = history(client, home_a, account)
    with pytest.raises(DBAPIError, match="Cannot downgrade wallets with correction history"):
        command.downgrade(config(), "0036_payment_method")
    assert balance(client, home_a, account) == before
    assert history(client, home_a, account) == receipts
    with database.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0037_wallet_corrections"
