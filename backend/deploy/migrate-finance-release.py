"""Apply only 0035/0036 atomically and verify every historical row is preserved."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

BASELINE = "0034_assistant_receipts"
REVISION = "0036_payment_method"
NEW_COLUMNS = {
    "sms_messages": ("time", "received_at", "transport_id", "identity_key", "parser_version", "transaction_id"),
    "transactions": ("payment_method",),
}


def fingerprint(connection, tables):
    result = {}
    for table in tables:
        quoted = connection.dialect.identifier_preparer.quote(table)
        result[table] = tuple(connection.execute(text(
            "SELECT count(*), md5(coalesce(string_agg(h, '' ORDER BY h), '')) "
            "FROM (SELECT md5((to_jsonb(t) - CAST(:columns AS text[]))::text) AS h "
            "FROM public." + quoted + " t) rows"
        ), {"columns": list(NEW_COLUMNS.get(table, ()))}).one())
    return result


def schema_state(connection, revision):
    if revision not in (BASELINE, REVISION):
        raise RuntimeError("Expected the exact 0.8.0 baseline or completed 0.9.0 schema.")
    for table, added in NEW_COLUMNS.items():
        columns = dict(connection.execute(text(
            "SELECT column_name, is_nullable FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:table"
        ), {"table": table}).all())
        if revision == BASELINE and set(added) & columns.keys():
            raise RuntimeError("Baseline contains unexpected financial columns; upgrade stopped.")
        if revision == REVISION and any(columns.get(name) != "YES" for name in added):
            raise RuntimeError("Financial columns are missing or not nullable; upgrade stopped.")
        rls = connection.execute(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE oid=to_regclass(:table)"
        ), {"table": "public." + table}).scalar_one()
        if not rls:
            raise RuntimeError("Financial RLS differs; upgrade stopped.")
    if revision == REVISION:
        constraints = set(connection.execute(text(
            "SELECT conname FROM pg_constraint WHERE convalidated AND "
            "conrelid IN ('public.sms_messages'::regclass, 'public.transactions'::regclass)"
        )).scalars())
        if not {"sms_transaction_family", "sms_link_recorded", "transaction_payment_method",
                "transaction_payment_fee"} <= constraints:
            raise RuntimeError("Financial constraints are missing; upgrade stopped.")
        indexes = set(connection.execute(text(
            "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
            "WHERE i.indisunique AND i.indisvalid AND i.indrelid='public.sms_messages'::regclass"
        )).scalars())
        if not {"sms_identity_unique", "sms_transaction_unique"} <= indexes:
            raise RuntimeError("SMS deduplication indexes are missing; upgrade stopped.")


def migrate(engine, app_role: str):
    paths = ["0035_sms_transaction_integrity.py", "0036_transaction_payment_method.py"]
    migrations = []
    previous = BASELINE
    for name in paths:
        spec = importlib.util.spec_from_file_location(name, Path.cwd() / "alembic/versions" / name)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if module.down_revision != previous:
            raise RuntimeError("Unexpected financial migration lineage; no migration performed.")
        previous = module.revision
        migrations.append(module)
    if previous != REVISION:
        raise RuntimeError("Unexpected financial migration target; no migration performed.")
    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout = '15s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout = '300s'")
        connection.exec_driver_sql("LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(text(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=:role"
        ), {"role": app_role}).one()
        if any(role):
            raise RuntimeError("Unrestricted application role; no migration performed.")
        schema_state(connection, revision)
        if revision == REVISION:
            print("Financial migration already verified; no data changed.")
            return
        tables = connection.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename <> 'alembic_version' ORDER BY tablename"
        )).scalars().all()
        for table in tables:
            quoted = connection.dialect.identifier_preparer.quote(table)
            connection.exec_driver_sql("LOCK TABLE public." + quoted + " IN SHARE ROW EXCLUSIVE MODE")
        before = fingerprint(connection, tables)
        with Operations.context(MigrationContext.configure(connection)):
            for migration in migrations:
                migration.upgrade()
        if fingerprint(connection, tables) != before:
            raise RuntimeError("Historical records changed; entire migration rolled back.")
        for table, columns in NEW_COLUMNS.items():
            condition = " OR ".join('"' + name + '" IS NOT NULL' for name in columns)
            if connection.exec_driver_sql("SELECT count(*) FROM public." + table + " WHERE " + condition).scalar_one():
                raise RuntimeError("Invented historical values; entire migration rolled back.")
        schema_state(connection, REVISION)
        connection.execute(text("UPDATE alembic_version SET version_num=:revision"), {"revision": REVISION})
    print("Financial columns added; all historical rows verified unchanged.")


def main():
    app = make_url(os.environ["DATABASE_URL"])
    if app.host != "db" or app.database != os.environ["POSTGRES_DB"]:
        raise RuntimeError("Installer requires the existing Compose database host and database.")
    admin = URL.create("postgresql+psycopg", username=os.environ["POSTGRES_USER"],
                       password=os.environ["POSTGRES_PASSWORD"], host="db", database=app.database)
    engine = create_engine(admin, hide_parameters=True)
    try:
        migrate(engine, app.username)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
