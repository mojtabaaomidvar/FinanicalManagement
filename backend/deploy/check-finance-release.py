"""Read-only exact-source preflight for the 0.8.0 -> 0.9.0 financial release."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

BASELINE = "0034_assistant_receipts"
REVISION = "0036_payment_method"


def matches(root: Path, hashes: dict[str, str]) -> bool:
    if root.is_symlink() or not root.is_dir():
        return False
    root = root.resolve()
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*")
              if path.is_file() and "__pycache__" not in path.parts}
    if actual != set(hashes):
        return False
    return all(not (root / name).is_symlink() and root in (root / name).resolve().parents
               and hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
               for name, digest in hashes.items())


def load_manifest(root):
    value = json.loads((root / "validation.json").read_text(encoding="utf-8"))
    if (value.get("tag"), value.get("software_version"), value.get("baseline_tag"),
        value.get("deployment_scope"), value.get("database_baseline_revision"),
        value.get("database_revision"), value.get("database_migration_required")) != (
            "v0.9.0", "0.9.0", "v0.8.0", "api-pwa-only", BASELINE, REVISION, True):
        raise SystemExit("Unexpected financial release contract; no files were replaced.")
    return value


def database_state():
    from sqlalchemy import text
    from app.db.session import engine

    with engine.connect() as connection:
        connection.exec_driver_sql("SET TRANSACTION READ ONLY")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(text(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )).one()
        if any(role):
            raise SystemExit("Unrestricted API role; upgrade stopped.")
        if revision not in (BASELINE, REVISION):
            raise SystemExit("Expected exact 0.8.0 or completed 0.9.0 database revision.")
        added = {"sms_messages": {"time", "received_at", "transport_id", "identity_key", "parser_version", "transaction_id"},
                 "transactions": {"payment_method"}}
        for table, expected in added.items():
            columns = dict(connection.execute(text(
                "SELECT column_name, is_nullable FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name=:table"
            ), {"table": table}).all())
            if ((revision == BASELINE and expected & columns.keys()) or
                (revision == REVISION and any(columns.get(name) != "YES" for name in expected))):
                raise SystemExit("Financial schema differs; upgrade stopped.")
            if not connection.execute(text(
                "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=to_regclass(:table)"
            ), {"table": "public." + table}).scalar_one():
                raise SystemExit("Financial RLS differs; upgrade stopped.")
        if revision == REVISION:
            constraints = set(connection.execute(text(
                "SELECT conname FROM pg_constraint WHERE convalidated AND "
                "conrelid IN ('public.sms_messages'::regclass, 'public.transactions'::regclass)"
            )).scalars())
            indexes = set(connection.execute(text(
                "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
                "WHERE i.indisunique AND i.indisvalid AND i.indrelid='public.sms_messages'::regclass"
            )).scalars())
            if (not {"sms_transaction_family", "sms_link_recorded", "transaction_payment_method", "transaction_payment_fee"} <= constraints
                or not {"sms_identity_unique", "sms_transaction_unique"} <= indexes):
                raise SystemExit("Financial constraints/indexes differ; upgrade stopped.")
    try:
        key = base64.b64decode(os.environ.get("DOCUMENT_ENCRYPTION_KEY", ""), validate=True)
    except (ValueError, TypeError):
        raise SystemExit("Existing encryption configuration is invalid; upgrade stopped.") from None
    if len(key) != 32 or not os.environ.get("FILE_SIGNING_SECRET"):
        raise SystemExit("Existing encryption/signing configuration is required; upgrade stopped.")
    # Nonfinancial assistance remains attached to the existing private gateway.
    if (os.environ.get("AI_SMS_GATEWAY_URL") != "https://api.khaanehyar.ir/ai-gateway"
        or os.environ.get("DEEPSEEK_API_KEY", "") or not os.environ.get("AI_SMS_GATEWAY_TOKEN")
        or os.environ.get("AI_SMS_MODEL") != "deepseek-flash"):
        raise SystemExit("Expected existing private gateway connection; upgrade stopped.")
    return "BASELINE" if revision == BASELINE else "ALREADY"


def main():
    mode = sys.argv[1]
    if mode in ("incoming", "contract", "pwa"):
        root = Path(sys.argv[2]).resolve()
        value = load_manifest(root)
        if mode == "contract":
            print(json.dumps({"incoming": value["backend_app_sha256"],
                              "baseline": value["baseline_backend_app_sha256"],
                              "alembic": value["alembic_sha256"],
                              "baseline_alembic": value["baseline_alembic_sha256"]}))
        elif mode == "incoming":
            for relative, key in [("pwa", "pwa_sha256"), ("source/backend/app", "backend_app_sha256"),
                                  ("source/backend/alembic", "alembic_sha256")]:
                if not matches(root / relative, value[key]):
                    raise SystemExit("Incoming release checksum mismatch; upgrade stopped.")
            for name, digest in value["backend_launch_sha256"].items():
                path = root / "source/backend" / name
                if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise SystemExit("Incoming launch checksum mismatch; upgrade stopped.")
            if json.loads((root / "pwa/version.json").read_text())["version"] != value["software_version"]:
                raise SystemExit("Incoming software version mismatch; upgrade stopped.")
            print("VERIFIED")
        else:
            web = Path(sys.argv[3])
            if matches(web, value["pwa_sha256"]):
                print("ALREADY")
            elif matches(web, value["baseline_pwa_sha256"]):
                print("BASELINE")
            else:
                raise SystemExit("Installed PWA differs from official 0.8.0; no files replaced.")
        return
    if mode not in ("container", "image", "rollback"):
        raise SystemExit("Unknown verification mode.")
    contract = json.loads(sys.argv[2])
    incoming = matches(Path.cwd() / "app", contract["incoming"])
    baseline = matches(Path.cwd() / "app", contract["baseline"])
    incoming_alembic = matches(Path.cwd() / "alembic", contract["alembic"])
    baseline_alembic = matches(Path.cwd() / "alembic", contract["baseline_alembic"])
    if mode == "image":
        if not incoming or not incoming_alembic:
            raise SystemExit("Built image differs from API/migration contract.")
        print("VERIFIED")
        return
    state = database_state()
    if mode == "rollback" and baseline and baseline_alembic:
        # Both revisions are additive/nullable; old API remains schema-compatible.
        print("ROLLBACK_VERIFIED")
    elif state == "ALREADY" and incoming and incoming_alembic:
        print("ALREADY")
    elif baseline and baseline_alembic:
        print("BASELINE" if state == "BASELINE" else "MIGRATED_BASELINE")
    else:
        raise SystemExit("API/schema is not a verified financial release; upgrade stopped.")


if __name__ == "__main__":
    main()
