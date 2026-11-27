"""Exact 0.10.0 -> 0.11.0 preflight; no records or secrets are printed."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

BASELINE = "0036_payment_method"
REVISION = "0037_wallet_corrections"
FUNCTIONS = ("public.wallet_ledger_balance(uuid,uuid)", "public.wallet_account_has_transactions(uuid)")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_hashes(hashes):
    if not isinstance(hashes, dict) or not hashes:
        raise ValueError("Incomplete source/checksum contract.")
    for name, checksum in hashes.items():
        path = PurePosixPath(name)
        if (path.is_absolute() or ".." in path.parts or str(path) != name or "\\" in name
                or not re.fullmatch(r"[0-9a-f]{64}", checksum)):
            raise ValueError("Unsafe checksum contract.")


def matches(root, hashes, *, python_cache=False):
    validate_hashes(hashes)
    if root.is_symlink() or not root.is_dir():
        return False
    entries = list(root.rglob("*"))
    if any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in entries):
        return False
    actual = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in entries if p.is_file() and not (python_cache and "__pycache__" in p.parts)}
    return actual == hashes


def manifest(root):
    value = json.loads((root / "validation.json").read_text(encoding="utf-8"))
    if (value.get("tag"), value.get("software_version"), value.get("baseline_tag"),
        value.get("deployment_scope"), value.get("database_baseline_revision"),
        value.get("database_revision"), value.get("database_migration_required"),
        value.get("money_contract")) != (
            "v0.11.0", "0.11.0", "v0.10.0", "api-pwa-only", BASELINE, REVISION, True, "decimal-v1"):
        raise ValueError("Unexpected wallet release contract.")
    if (root / "release-tag.txt").read_bytes() != b"v0.11.0\n":
        raise ValueError("Unexpected release tag.")
    for key in ("pwa_sha256", "baseline_pwa_sha256", "backend_app_sha256", "baseline_backend_app_sha256",
                "alembic_sha256", "baseline_alembic_sha256", "backend_launch_sha256", "deploy_sha256"):
        validate_hashes(value[key])
    if set(value["schema_sha256"]) != {BASELINE, REVISION} or any(
            not re.fullmatch(r"[0-9a-f]{64}", x) for x in value["schema_sha256"].values()):
        raise ValueError("Incomplete schema reference.")
    return value


def schema_digest(connection):
    """Catalog definitions only, excluding database-specific OIDs/owners/ACLs."""
    from sqlalchemy import text
    queries = {
        "columns": "SELECT table_name,column_name,udt_name,numeric_precision,numeric_scale,is_nullable,column_default "
                   "FROM information_schema.columns WHERE table_schema='public' AND table_name IN "
                   "('accounts','transactions','wallet_corrections') ORDER BY table_name,ordinal_position",
        "constraints": "SELECT conrelid::regclass::text,conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint "
                       "WHERE connamespace='public'::regnamespace AND conrelid IN "
                       "(to_regclass('public.accounts'),to_regclass('public.transactions'),to_regclass('public.wallet_corrections')) "
                       "ORDER BY conrelid::regclass::text,conname",
        "functions": "SELECT proname,pg_get_function_identity_arguments(oid),pg_get_functiondef(oid) FROM pg_proc "
                     "WHERE pronamespace='public'::regnamespace AND proname LIKE 'wallet\\_%' ESCAPE '\\' ORDER BY proname",
        "triggers": "SELECT tgrelid::regclass::text,tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger "
                    "WHERE NOT tgisinternal AND tgrelid IN (to_regclass('public.accounts'),to_regclass('public.transactions'),"
                    "to_regclass('public.wallet_corrections')) ORDER BY tgrelid::regclass::text,tgname",
        "policies": "SELECT polrelid::regclass::text,polname,polcmd,polpermissive,"
                    "ARRAY(SELECT CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role)::text END "
                    "FROM unnest(polroles) role ORDER BY 1)::text,pg_get_expr(polqual,polrelid),"
                    "pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid IN (to_regclass('public.accounts'),"
                    "to_regclass('public.transactions'),to_regclass('public.wallet_corrections')) ORDER BY polrelid::regclass::text,polname",
        "rls": "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace "
               "AND relname IN ('accounts','transactions','wallet_corrections') ORDER BY relname",
        "indexes": "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN "
                   "('accounts','transactions','wallet_corrections') ORDER BY tablename,indexname",
    }
    return digest({name: [list(row) for row in connection.execute(text(sql))] for name, sql in queries.items()})


def restricted_role(connection, role):
    from sqlalchemy import text
    flags = connection.execute(text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=:role"), {"role": role}).one()
    if any(flags):
        raise RuntimeError("Unrestricted application role; installation stopped.")


def schema_state(connection, contract, role, *, check_grants=True):
    from sqlalchemy import text
    revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    if revision not in (BASELINE, REVISION):
        raise RuntimeError("Expected exact 0.10.0 baseline or completed 0.11.0 revision.")
    restricted_role(connection, role)
    if schema_digest(connection) != contract["schema_sha256"][revision]:
        raise RuntimeError("Wallet schema/security differs from tested reference; installation stopped.")
    if revision == REVISION:
        for function in FUNCTIONS:
            details = connection.execute(text(
                "SELECT p.prosecdef,r.rolsuper OR r.rolbypassrls,EXISTS(SELECT 1 FROM "
                "aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') "
                "FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure(:function)"
            ), {"function": function}).one()
            if tuple(details) != (True, True, False):
                raise RuntimeError("Wallet projection owner/PUBLIC permissions differ.")
            if check_grants and not connection.scalar(text("SELECT has_function_privilege(:role,:function,'EXECUTE')"),
                                                        {"role": role, "function": function}):
                raise RuntimeError("Wallet projection grant is missing.")
        if check_grants:
            for privilege, expected in (("SELECT", True), ("INSERT", True), ("UPDATE", False), ("DELETE", False)):
                actual = connection.scalar(text("SELECT has_table_privilege(:role,'public.wallet_corrections',:privilege)"),
                                           {"role": role, "privilege": privilege})
                if actual is not expected:
                    raise RuntimeError("Wallet receipt grants differ.")
    return revision


def database_engine():
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL, make_url
    app = make_url(os.environ["DATABASE_URL"])
    if app.host != "db" or app.database != os.environ["POSTGRES_DB"] or not app.username:
        raise RuntimeError("Existing Compose application/database contract differs.")
    admin = URL.create("postgresql+psycopg", username=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASSWORD"],
                       host="db", database=app.database, query={"connect_timeout": "10"})
    return create_engine(admin, hide_parameters=True), app.username


def database_state(contract, *, rollback=False):
    from sqlalchemy import text
    # Validate existing private configuration without returning values.
    key = base64.b64decode(os.environ.get("DOCUMENT_ENCRYPTION_KEY", ""), validate=True)
    if len(key) != 32 or not os.environ.get("FILE_SIGNING_SECRET"):
        raise RuntimeError("Existing encryption/signing settings are required.")
    if (os.environ.get("AI_SMS_GATEWAY_URL") != "https://api.khaanehyar.ir/ai-gateway" or
            not os.environ.get("AI_SMS_GATEWAY_TOKEN") or os.environ.get("AI_SMS_MODEL") != "deepseek-flash" or
            os.environ.get("DEEPSEEK_API_KEY", "")):
        raise RuntimeError("Existing private gateway settings differ.")
    engine, role = database_engine()
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            revision = schema_state(connection, contract, role)
            if rollback and revision == REVISION and (
                    connection.scalar(text("SELECT count(*) FROM wallet_corrections")) or
                    connection.scalar(text("SELECT count(*) FROM transactions WHERE source_kind='wallet_correction'"))):
                raise RuntimeError("Wallet audit history exists; old API must not restart.")
            return "BASELINE" if revision == BASELINE else "ALREADY"
    finally:
        engine.dispose()


def public(root):
    value = manifest(root)
    for name, checksum in value["pwa_sha256"].items():
        url = "https://pwa.khaanehyar.ir/" + urllib.parse.quote(name) + "?verify=wallet-0.11.0"
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=30) as response:
            if hashlib.sha256(response.read()).hexdigest() != checksum:
                raise ValueError("Public PWA checksum differs: " + name)
    # No bearer, body or real financial operation is used.
    for method, headers, status in [
        ("GET", {"Origin": "https://pwa.khaanehyar.ir"}, 409),
        ("GET", {"Origin": "https://pwa.khaanehyar.ir", "X-Khaneyar-Money-Contract": "decimal-v1"}, 401),
        ("OPTIONS", {"Origin": "https://pwa.khaanehyar.ir", "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "X-Khaneyar-Money-Contract, Authorization, Content-Type"}, 200),
    ]:
        request = urllib.request.Request("https://api.khaanehyar.ir/api/v1/accounts", method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.status != status or response.headers.get("Access-Control-Allow-Origin") != headers["Origin"]:
                raise ValueError("Public money contract/CORS check failed.")
            if status == 409 and json.load(response).get("error") != "CLIENT_UPDATE_REQUIRED":
                raise ValueError("Public old-client gate differs.")
    print("PUBLIC VERIFIED: " + str(len(value["pwa_sha256"])) + " PWA files; contract/CORS verified")


def main():
    mode = sys.argv[1]
    if mode in ("incoming", "contract", "pwa", "public"):
        root = Path(sys.argv[2])
        value = manifest(root)
        if mode == "contract":
            print(json.dumps({key: value[key] for key in ("backend_app_sha256", "baseline_backend_app_sha256", "alembic_sha256",
                             "baseline_alembic_sha256", "schema_sha256")}))
        elif mode == "incoming":
            for relative, key in (("pwa", "pwa_sha256"), ("source/backend/app", "backend_app_sha256"),
                                  ("source/backend/alembic", "alembic_sha256"), ("source/backend/deploy", "deploy_sha256")):
                if not matches(root / relative, value[key]):
                    raise ValueError("Incoming source/checksum mismatch: " + relative)
            for name, checksum in value["backend_launch_sha256"].items():
                path = root / "source/backend" / name
                if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
                    raise ValueError("Incoming launch checksum mismatch.")
            if json.loads((root / "pwa/version.json").read_text())["version"] != "0.11.0":
                raise ValueError("Incoming version differs.")
            print("VERIFIED")
        elif mode == "public":
            public(root)
        else:
            web = Path(sys.argv[3])
            if matches(web, value["pwa_sha256"]):
                print("ALREADY")
            elif matches(web, value["baseline_pwa_sha256"]):
                print("BASELINE")
            else:
                raise ValueError("Installed PWA differs from official baseline/release; files preserved.")
        return
    contract = json.loads(sys.argv[2])
    for key in ("backend_app_sha256", "baseline_backend_app_sha256", "alembic_sha256", "baseline_alembic_sha256"):
        validate_hashes(contract[key])
    incoming = matches(Path.cwd() / "app", contract["backend_app_sha256"], python_cache=True)
    baseline = matches(Path.cwd() / "app", contract["baseline_backend_app_sha256"], python_cache=True)
    new_alembic = matches(Path.cwd() / "alembic", contract["alembic_sha256"], python_cache=True)
    old_alembic = matches(Path.cwd() / "alembic", contract["baseline_alembic_sha256"], python_cache=True)
    if mode == "image":
        if not incoming or not new_alembic:
            raise ValueError("API image source/migrations differ.")
        print("VERIFIED")
        return
    state = database_state(contract, rollback=mode == "rollback")
    if mode == "rollback" and baseline and old_alembic:
        print("ROLLBACK_VERIFIED")
    elif mode == "container" and incoming and new_alembic and state == "ALREADY":
        print("ALREADY")
    elif mode == "container" and baseline and old_alembic:
        print("BASELINE" if state == "BASELINE" else "MIGRATED_BASELINE")
    else:
        raise ValueError("API source/schema is not a verified wallet release state.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Wallet release verification failed; no secret diagnostics printed.") from None
