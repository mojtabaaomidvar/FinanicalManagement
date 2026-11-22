"""Run only the approved inventory migration, with data checks inside its transaction."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

REVISION = "0033_inventory_categories"


def fingerprint(connection, tables):
    result = {}
    for table in tables:
        quoted = connection.dialect.identifier_preparer.quote(table)
        expression = "to_jsonb(t)"
        if table == "inventory_items":
            expression += " - ARRAY['threshold','category']"
        result[table] = tuple(connection.exec_driver_sql(
            "SELECT count(*), md5(coalesce(string_agg((" + expression  # noqa: S608 -- quoted table names
            + ")::text, '' ORDER BY (" + expression + ")::text), '')) FROM " + quoted + " t"
        ).one())
    return result


def migrate(engine, app_role: str) -> None:
    path = Path.cwd() / "alembic/versions/0033_inventory_categories.py"
    spec = importlib.util.spec_from_file_location("inventory_release_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    if (migration.revision, migration.down_revision) != (REVISION, "0029"):
        raise RuntimeError("Unexpected migration lineage; no migration performed.")
    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout = '15s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout = '120s'")
        connection.exec_driver_sql("LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=:role"),
            {"role": app_role},
        ).one()
        if any(role) or revision not in ("0029", REVISION):
            raise RuntimeError("Unexpected revision or unrestricted application role.")
        if revision == REVISION:
            print("Inventory migration already applied; no data changed.")
            return
        tables = connection.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename <> 'alembic_version' ORDER BY tablename")).scalars().all()
        before = fingerprint(connection, tables)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        if fingerprint(connection, tables) != before:
            raise RuntimeError("Unexpected existing-record change; entire migration rolled back.")
        proposal_count = connection.execute(
            text("SELECT count(*) FROM inventory_catalog_proposals")
        ).scalar_one()
        if proposal_count:
            raise RuntimeError("Unexpected proposal records; entire migration rolled back.")
        rls = connection.execute(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE oid='public.inventory_items'::regclass")).scalar_one()
        if not rls:
            raise RuntimeError("Inventory RLS not restored; entire migration rolled back.")
        quoted_role = connection.dialect.identifier_preparer.quote(app_role)
        connection.exec_driver_sql("GRANT SELECT, INSERT, UPDATE, DELETE ON "
                                  "inventory_catalog_proposals TO " + quoted_role)
        connection.execute(
            text("UPDATE alembic_version SET version_num=:revision"), {"revision": REVISION}
        )
    print("Inventory migration committed; existing records preserved "
          "except approved category/threshold changes.")


def main() -> None:
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
