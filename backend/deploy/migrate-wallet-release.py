"""Apply only 0037 atomically, preserve historical rows, grant least privilege."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

spec = importlib.util.spec_from_file_location("wallet_release_checker", Path(__file__).with_name("check-wallet-release.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def tables(connection):
    return connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' "
                                   "AND tablename<>'alembic_version' ORDER BY tablename")).scalars().all()


def fingerprint(connection, names, *, omit_new_revision=True):
    result = {}
    for name in names:
        quoted = connection.dialect.identifier_preparer.quote(name)
        excluded = ["balance_revision"] if name == "accounts" and omit_new_revision else []
        result[name] = tuple(connection.execute(text(
            "SELECT count(*),md5(coalesce(string_agg(h,'' ORDER BY h),'')) FROM "
            "(SELECT md5((to_jsonb(t)-CAST(:excluded AS text[]))::text) h FROM public." + quoted + " t) rows"
        ), {"excluded": excluded}).one())
    return result


def migrate(engine, role, contract):
    path = Path.cwd() / "alembic/versions/0037_wallet_corrections.py"
    spec = importlib.util.spec_from_file_location("wallet_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    if (migration.down_revision, migration.revision) != (checker.BASELINE, checker.REVISION):
        raise RuntimeError("Wallet migration lineage differs.")
    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout='15s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout='300s'")
        connection.exec_driver_sql("LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE")
        revision = checker.schema_state(connection, contract, role)
        if revision == checker.REVISION:
            print("Wallet migration already verified; no records or grants changed.")
            return
        names = tables(connection)
        for name in names:
            connection.exec_driver_sql("LOCK TABLE public." + connection.dialect.identifier_preparer.quote(name) + " IN SHARE ROW EXCLUSIVE MODE")
        before = fingerprint(connection, names)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        if fingerprint(connection, names) != before:
            raise RuntimeError("Historical records changed; entire migration rolled back.")
        if connection.scalar(text("SELECT count(*) FROM accounts WHERE balance_revision<>0")) or connection.scalar(text("SELECT count(*) FROM wallet_corrections")):
            raise RuntimeError("Invented wallet history; entire migration rolled back.")
        quoted_role = connection.dialect.identifier_preparer.quote(role)
        connection.exec_driver_sql("REVOKE ALL ON public.wallet_corrections FROM PUBLIC")
        connection.exec_driver_sql("REVOKE ALL ON public.wallet_corrections FROM " + quoted_role)
        connection.exec_driver_sql("GRANT SELECT,INSERT ON public.wallet_corrections TO " + quoted_role)
        for function in checker.FUNCTIONS:
            connection.exec_driver_sql("GRANT EXECUTE ON FUNCTION " + function + " TO " + quoted_role)
        connection.execute(text("UPDATE alembic_version SET version_num=:revision"), {"revision": checker.REVISION})
        checker.schema_state(connection, contract, role)
    print("Wallet migration committed; all historical rows unchanged; restricted grants verified.")


if __name__ == "__main__":
    try:
        engine, role = checker.database_engine()
        try:
            migrate(engine, role, json.loads(sys.argv[1]))
        finally:
            engine.dispose()
    except Exception:
        raise SystemExit("Wallet migration stopped; transaction rolled back; no secret diagnostics printed.") from None
