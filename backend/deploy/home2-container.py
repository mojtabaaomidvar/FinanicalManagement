"""Checked Home 2 upgrade after the already-installed management 0.3.0 schema."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("home2_analytics", HERE / "management/analytics-container.py")
analytics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analytics)

BASELINE = "0039"
REVISION = "0042_meal_inventory_links"
STEPS = (
    ("0040_inventory_catalog.py", BASELINE, "0040_inventory_catalog"),
    ("0041_household_changes.py", "0040_inventory_catalog", "0041_household_changes"),
    ("0042_meal_inventory_links.py", "0041_household_changes", REVISION),
)
ADDED_COLUMNS = {"inventory_catalog_proposals": ["published_at"], "inventory_items": ["catalog_id"]}
MEAL_CONSTRAINT = "ck_meal_entries_meal_entry_type_valid"


def fingerprint(connection, names):
    from sqlalchemy import text

    result = {}
    for name in names:
        quoted = connection.dialect.identifier_preparer.quote(name)
        result[name] = tuple(connection.execute(text(
            "SELECT count(*),md5(coalesce(string_agg(h,'' ORDER BY h),'')) FROM "
            "(SELECT md5((to_jsonb(t)-CAST(:omitted AS text[]))::text) h FROM public." + quoted + " t) rows"
        ), {"omitted": ADDED_COLUMNS.get(name, [])}).one())
    return result


def retained_catalog(connection, names):
    values = analytics.catalog(connection, names)
    for name, sections in values.items():
        sections[0] = [row for row in sections[0] if row[0] not in ADDED_COLUMNS.get(name, [])]
        if name == "meal_entries":
            sections[1] = [row for row in sections[1] if row[0] != MEAL_CONSTRAINT]
        sections[3] = [row for row in sections[3] if row[0] != "household_changed"]
    return values


def verify_database(connection, role):
    from sqlalchemy import text

    analytics.verify_grants(connection, role)
    revision = connection.scalar(text("SELECT version_num FROM public.alembic_version"))
    if revision == BASELINE:
        if connection.scalar(text("SELECT to_regclass('public.inventory_catalog_entries')")) is not None:
            raise ValueError("Partial Home 2 schema exists")
        for table, columns in ADDED_COLUMNS.items():
            if connection.scalar(text("SELECT count(*) FROM information_schema.columns "
                                      "WHERE table_schema='public' AND table_name=:table "
                                      "AND column_name=:column"), {"table": table, "column": columns[0]}):
                raise ValueError("Partial Home 2 columns exist")
        if connection.scalar(text("SELECT to_regprocedure('public.notify_household_change()')")) is not None:
            raise ValueError("Partial household notification function exists")
        return revision
    if revision != REVISION:
        raise ValueError("Expected installed management revision 0039 or completed Home 2 release")
    for table, column, kind in (("inventory_catalog_proposals", "published_at", "timestamptz"),
                                ("inventory_items", "catalog_id", "text")):
        actual = connection.execute(text("SELECT udt_name,is_nullable FROM information_schema.columns "
                                         "WHERE table_schema='public' AND table_name=:table AND column_name=:column"),
                                    {"table": table, "column": column}).one()
        if tuple(actual) != (kind, "YES"):
            raise ValueError("Home 2 column shape differs")
    shape = dict(connection.execute(text("SELECT column_name,udt_name FROM information_schema.columns "
                                         "WHERE table_schema='public' AND table_name='inventory_catalog_entries'")).all())
    if shape != {"id": "uuid", "name_key": "text", "title": "text", "category": "text",
                 "unit": "text", "published_at": "timestamptz"}:
        raise ValueError("Catalog table shape differs")
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
        actual = connection.scalar(text("SELECT has_table_privilege(:role,'public.inventory_catalog_entries',:p)"),
                                   {"role": role, "p": privilege})
        if actual != (privilege in {"SELECT", "INSERT"}):
            raise ValueError("Catalog application privileges differ")
    if connection.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_class c,LATERAL "
                              "aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a "
                              "WHERE c.oid='public.inventory_catalog_entries'::regclass AND a.grantee=0)")):
        raise ValueError("Catalog table is exposed to PUBLIC")
    constraint = connection.scalar(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                        "WHERE conrelid='public.meal_entries'::regclass AND conname=:name"),
                                   {"name": MEAL_CONSTRAINT})
    if not constraint or not all("'" + kind + "'" in constraint for kind in ("breakfast", "lunch", "dinner", "snack")):
        raise ValueError("Meal slot constraint differs")
    tables = connection.execute(text("SELECT table_name FROM information_schema.columns "
                                     "WHERE table_schema='public' AND column_name='family_id' "
                                     "AND table_name NOT LIKE '%receipt%' AND table_name NOT LIKE 'usage_%' "
                                     "UNION SELECT 'families'")).scalars()
    for name in tables:
        if not connection.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(:table) "
                                      "AND tgname='household_changed' AND tgenabled='O' "
                                      "AND tgfoid=to_regprocedure('public.notify_household_change()'))"),
                                 {"table": "public." + name}):
            raise ValueError("Household change trigger differs")
    return revision


def migrate(engine, role, root, *, after_step=None):
    from alembic.config import Config
    from alembic.operations import Operations
    from alembic.runtime.environment import EnvironmentContext
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout='15s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout='300s'")
        connection.exec_driver_sql("LOCK TABLE public.alembic_version IN ACCESS EXCLUSIVE MODE")
        revision = verify_database(connection, role)
        if revision == REVISION:
            return "ALREADY"
        names = connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' "
                                        "AND tablename<>'alembic_version' ORDER BY tablename")).scalars().all()
        for name in names:
            connection.exec_driver_sql("LOCK TABLE public." + connection.dialect.identifier_preparer.quote(name)
                                       + " IN SHARE ROW EXCLUSIVE MODE")
        before, schema = fingerprint(connection, names), retained_catalog(connection, names)
        cfg = Config()
        cfg.set_main_option("script_location", str(root / "alembic"))
        with EnvironmentContext(cfg, ScriptDirectory.from_config(cfg)) as environment:
            environment.configure(connection=connection)
            with Operations.context(environment.get_context()):
                for filename, previous, current in STEPS:
                    spec = importlib.util.spec_from_file_location("home2_" + current, root / "alembic/versions" / filename)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    if (module.down_revision, module.revision) != (previous, current):
                        raise ValueError("Home 2 migration lineage differs")
                    module.upgrade()
                    if after_step is not None:
                        after_step(current)
        quoted = connection.dialect.identifier_preparer.quote(role)
        connection.exec_driver_sql("REVOKE ALL ON public.inventory_catalog_entries FROM PUBLIC")
        connection.exec_driver_sql("REVOKE ALL ON public.inventory_catalog_entries FROM " + quoted)
        connection.exec_driver_sql("GRANT SELECT,INSERT ON public.inventory_catalog_entries TO " + quoted)
        if fingerprint(connection, names) != before or retained_catalog(connection, names) != schema:
            raise ValueError("Historical records or unrelated schema changed; migration rolled back")
        if connection.scalar(text("SELECT count(*) FROM public.inventory_catalog_entries")):
            raise ValueError("Migration invented catalog records")
        for table, columns in ADDED_COLUMNS.items():
            if connection.scalar(text("SELECT count(*) FROM public." + table + " WHERE " + columns[0] + " IS NOT NULL")):
                raise ValueError("Migration invented catalog links")
        connection.execute(text("UPDATE public.alembic_version SET version_num=:revision"), {"revision": REVISION})
        verify_database(connection, role)
    return "MIGRATED"


def main(mode=None, contract=None, database=None):
    if mode is None:
        mode = sys.argv[1]
        database = sys.argv[2] if len(sys.argv) > 2 else None
    if contract is None:
        contract = json.loads((HERE / "validation.json").read_text())["container"]
    state = analytics.source_state(contract)
    if mode == "source":
        print(state)
        return
    if mode == "image":
        if state != "NEW":
            raise ValueError("Unexpected Home 2 image")
        import app.main  # noqa: F401
        print("VERIFIED")
        return
    engine, role = analytics.database_engine(database)
    try:
        if mode == "migrate":
            if state != "NEW":
                raise ValueError("Migration requires the new checked image")
            print(migrate(engine, role, Path.cwd()))
        elif mode == "database":
            with engine.connect() as connection:
                connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                print(verify_database(connection, role))
        else:
            raise ValueError("Unknown Home 2 mode")
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Home 2 container verification failed; private diagnostics withheld.") from None
