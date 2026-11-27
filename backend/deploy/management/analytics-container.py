"""Checked, additive 0037 -> 0039 upgrade. Invoked through private container stdin."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

BASELINE = "0037_wallet_corrections"
REVISION = "0039"
NEW_TABLES = ("support_ai_counters", "ai_daily_allowances", "ai_capacity_leases")
GRANTS = {
    "support_ai_counters": {"SELECT", "INSERT", "UPDATE"},
    "ai_daily_allowances": {"SELECT", "INSERT", "UPDATE", "DELETE"},
    "ai_capacity_leases": {"SELECT", "INSERT", "UPDATE", "DELETE"},
}
SHAPES = {
    "support_ai_counters": {"hour": "timestamptz", "stage": "text", "status": "text",
                            **{key: "int8" for key in ("requests", "input_tokens", "output_tokens",
                                                      "input_token_requests", "output_token_requests")}},
    "ai_daily_allowances": {"day": "date", "scope": "text", "requests": "int8"},
    "ai_capacity_leases": {"id": "uuid", "expires_at": "timestamptz"},
}


def tree(root):
    result = {}
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Source root missing or linked")
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("Linked source")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
            data = path.read_bytes()
            if path.suffix in {".py", ".json", ".mako", ".ini", ".toml"} or path.name == "LICENSE":
                data = data.replace(b"\r\n", b"\n")
            result[path.relative_to(root).as_posix()] = hashlib.sha256(data).hexdigest()
    return result


def source_state(contract, root=None):
    root = Path.cwd() if root is None else root
    app, alembic = tree(root / "app"), tree(root / "alembic")
    if hashlib.sha256((root / "pyproject.toml").read_bytes().replace(b"\r\n", b"\n")).hexdigest() != contract["pyproject_sha256"]:
        raise ValueError("Existing API dependencies differ")
    if app == contract["app_sha256"] and alembic == contract["alembic_sha256"]:
        return "NEW"
    if alembic == contract["baseline_alembic_sha256"]:
        for candidate in contract["baseline_app_variants"]:
            if app == candidate:
                return "BASELINE"
    raise ValueError("Existing API source differs from the supported baseline")


def database_engine(database=None):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL, make_url

    app = make_url(os.environ["DATABASE_URL"])
    if app.host != "db" or app.database != os.environ["POSTGRES_DB"] or not app.username:
        raise ValueError("Unsupported database configuration")
    if database is not None and not database.startswith("khaneyar_analytics_restore_"):
        raise ValueError("Unexpected restore database")
    url = URL.create("postgresql+psycopg", username=os.environ["POSTGRES_USER"],
                     password=os.environ["POSTGRES_PASSWORD"], host="db",
                     database=database or app.database, query={"connect_timeout": "10"})
    return create_engine(url, hide_parameters=True), app.username


def restricted(connection, role):
    from sqlalchemy import text

    flags = connection.execute(text(
        "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=:role"
    ), {"role": role}).one()
    if any(flags):
        raise ValueError("API database role is not restricted")


def verify_grants(connection, role):
    from sqlalchemy import text

    restricted(connection, role)
    for table, expected in GRANTS.items():
        columns = connection.execute(text(
            "SELECT column_name,udt_name,is_nullable FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:name"
        ), {"name": table}).all()
        if {name: data_type for name, data_type, nullable in columns} != SHAPES[table] or any(
                nullable != "NO" for name, data_type, nullable in columns):
            raise ValueError("New-table schema differs")
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
            actual = connection.scalar(text("SELECT has_table_privilege(:role,:table,:privilege)"),
                                       {"role": role, "table": "public." + table, "privilege": privilege})
            if actual != (privilege in expected):
                raise ValueError("New-table API privileges differ")
        if connection.scalar(text(
            "SELECT EXISTS(SELECT 1 FROM pg_class c, LATERAL "
            "aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a "
            "WHERE c.oid=to_regclass(:table) AND a.grantee=0)"
        ), {"table": "public." + table}):
            raise ValueError("New table is exposed to PUBLIC")


def fingerprint(connection, names):
    from sqlalchemy import text

    result = {}
    for name in names:
        quoted = connection.dialect.identifier_preparer.quote(name)
        result[name] = tuple(connection.execute(text(
            "SELECT count(*),md5(coalesce(string_agg(h,'' ORDER BY h),'')) "
            "FROM (SELECT md5(to_jsonb(t)::text) h FROM public." + quoted + " t) rows"
        )).one())
    return result


def catalog(connection, names):
    """Prove existing columns, constraints, policies, triggers and grants remain identical."""
    from sqlalchemy import text

    result = {}
    for name in names:
        values = {"name": name, "table": "public." + name}
        queries = (
            "SELECT column_name,udt_name,is_nullable,column_default,numeric_precision,numeric_scale "
            "FROM information_schema.columns WHERE table_schema='public' AND table_name=:name ORDER BY ordinal_position",
            "SELECT conname,pg_get_constraintdef(oid),convalidated FROM pg_constraint "
            "WHERE conrelid=to_regclass(:table) ORDER BY conname",
            "SELECT polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),"
            "pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid=to_regclass(:table) ORDER BY polname",
            "SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger "
            "WHERE tgrelid=to_regclass(:table) AND NOT tgisinternal ORDER BY tgname",
            "SELECT relrowsecurity,relforcerowsecurity,relacl::text FROM pg_class WHERE oid=to_regclass(:table)",
        )
        result[name] = [[tuple(row) for row in connection.execute(text(sql), values)] for sql in queries]
    return result


def migrate(engine, role, root, *, after_step=None):
    from alembic.config import Config
    from alembic.runtime.environment import EnvironmentContext
    from alembic.script import ScriptDirectory
    from alembic.operations import Operations
    from sqlalchemy import text

    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout='15s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout='300s'")
        connection.exec_driver_sql("LOCK TABLE public.alembic_version IN ACCESS EXCLUSIVE MODE")
        restricted(connection, role)
        revision = connection.execute(text("SELECT version_num FROM public.alembic_version")).scalar_one()
        if revision == REVISION:
            verify_grants(connection, role)
            return "ALREADY"
        if revision != BASELINE:
            raise ValueError("Only revision 0037_wallet_corrections is supported")
        names = connection.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename<>'alembic_version' ORDER BY tablename"
        )).scalars().all()
        if set(names) & set(NEW_TABLES):
            raise ValueError("Partial or unrelated AI schema exists")
        for name in names:
            connection.exec_driver_sql("LOCK TABLE public." + connection.dialect.identifier_preparer.quote(name)
                                      + " IN SHARE ROW EXCLUSIVE MODE")
        before, schema = fingerprint(connection, names), catalog(connection, names)
        cfg = Config()
        cfg.set_main_option("script_location", str(root / "alembic"))
        scripts = ScriptDirectory.from_config(cfg)
        with EnvironmentContext(cfg, scripts) as environment:
            environment.configure(connection=connection)
            with Operations.context(environment.get_context()):
                for filename, previous, current in (
                    ("0038_ai_usage_counters.py", BASELINE, "0038"),
                    ("0039_ai_capacity.py", "0038", REVISION),
                ):
                    spec = importlib.util.spec_from_file_location("release_" + current, root / "alembic/versions" / filename)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    if (module.down_revision, module.revision) != (previous, current):
                        raise ValueError("Migration lineage differs")
                    module.upgrade()
                    if after_step is not None:
                        after_step(current)
        quoted_role = connection.dialect.identifier_preparer.quote(role)
        for name, privileges in GRANTS.items():
            connection.exec_driver_sql("REVOKE ALL ON public." + name + " FROM PUBLIC")
            connection.exec_driver_sql("REVOKE ALL ON public." + name + " FROM " + quoted_role)
            connection.exec_driver_sql("GRANT " + ",".join(sorted(privileges)) + " ON public." + name + " TO " + quoted_role)
        if fingerprint(connection, names) != before or catalog(connection, names) != schema:
            raise ValueError("Historical data or schema changed; upgrade rolled back")
        if any(connection.scalar(text("SELECT count(*) FROM public." + name)) for name in NEW_TABLES):
            raise ValueError("New tables must start empty")
        connection.execute(text("UPDATE public.alembic_version SET version_num=:revision"), {"revision": REVISION})
        verify_grants(connection, role)
    return "MIGRATED"


def main(mode, contract, database=None):
    state = source_state(contract)
    if mode == "source":
        print(state)
        return
    if mode == "image":
        if state != "NEW":
            raise ValueError("Incorrect image")
        import app.main
        print("VERIFIED")
        return
    engine, role = database_engine(database)
    try:
        if mode == "migrate":
            if state != "NEW":
                raise ValueError("Migration requires the new checked image")
            print(migrate(engine, role, Path.cwd()))
        elif mode == "database":
            from sqlalchemy import text
            with engine.connect() as connection:
                connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                revision = connection.scalar(text("SELECT version_num FROM public.alembic_version"))
                restricted(connection, role)
                if revision == REVISION:
                    verify_grants(connection, role)
                elif revision != BASELINE:
                    raise ValueError("Unexpected database revision")
                print(revision)
        else:
            raise ValueError("Unknown verification mode")
    finally:
        engine.dispose()
