"""Read-only checks for the meals release on the official 0.7.2 baseline."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

BASELINE = "0033_inventory_categories"
REVISION = "0034_assistant_receipts"


def matches(root: Path, hashes: dict[str, str]) -> bool:
    root = root.resolve()
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*")
              if path.is_file() and "__pycache__" not in path.parts}
    if actual != set(hashes):
        return False
    return all(not (root / name).is_symlink()
               and root in (root / name).resolve().parents
               and hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
               for name, digest in hashes.items())


def load_manifest(root: Path) -> dict:
    value = json.loads((root / "validation.json").read_text(encoding="utf-8"))
    if (value.get("tag"), value.get("software_version"), value.get("deployment_scope"),
        value.get("database_baseline_revision"), value.get("database_revision"),
        value.get("database_migration_required")) != (
            "v0.8.0", "0.8.0", "api-pwa-only", REVISION, REVISION, False):
        raise SystemExit("Unexpected meals release contract; no files were replaced.")
    return value


def database_state() -> str:
    from sqlalchemy import text

    from app.db.session import engine

    with engine.connect() as connection:
        connection.exec_driver_sql("SET TRANSACTION READ ONLY")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(text(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).one()
        if any(role) or revision not in (BASELINE, REVISION):
            raise SystemExit("Unexpected revision or unrestricted API role; upgrade stopped.")
        rls = connection.execute(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE oid='public.inventory_items'::regclass")).scalar_one()
        fields = set(connection.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='inventory_items'")).scalars())
        if not rls or "threshold" in fields or "category" not in fields:
            raise SystemExit("Released inventory schema/RLS differs; upgrade stopped.")
        if connection.execute(text(
            "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.inventory_items'::regclass "
            "AND tgname='inventory_items_revision' AND NOT tgisinternal"
        )).scalar_one_or_none() != "O":
            raise SystemExit("Inventory revision trigger differs; upgrade stopped.")
        receipts = connection.execute(text(
            "SELECT to_regclass('public.assistant_execution_receipts')"
        )).scalar_one()
        if revision == BASELINE and receipts is not None:
            raise SystemExit("Baseline already contains an unexpected receipt table.")
        if revision == REVISION:
            if receipts is None or not connection.execute(text(
                "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                "WHERE oid='public.assistant_execution_receipts'::regclass"
            )).scalar_one():
                raise SystemExit("Receipt RLS differs; upgrade stopped.")
            if (os.environ.get("AI_SMS_GATEWAY_URL") != "https://api.khaanehyar.ir/ai-gateway"
                or os.environ.get("DEEPSEEK_API_KEY", "")
                or not os.environ.get("AI_SMS_GATEWAY_TOKEN")
                or os.environ.get("AI_SMS_MODEL") != "deepseek-flash"):
                raise SystemExit("Expected private gateway connection; upgrade stopped.")
        if not os.environ.get("FILE_SIGNING_SECRET"):
            raise SystemExit("Existing signing secret required; upgrade stopped.")
    try:
        key = base64.b64decode(os.environ.get("DOCUMENT_ENCRYPTION_KEY", ""), validate=True)
    except (ValueError, TypeError):
        raise SystemExit("Existing encryption configuration is invalid; upgrade stopped.") from None
    if len(key) != 32:
        raise SystemExit("Existing encryption configuration is missing; upgrade stopped.")
    return "BASELINE" if revision == BASELINE else "ALREADY"


def main() -> None:
    mode = sys.argv[1]
    if mode in ("incoming", "contract", "pwa"):
        root = Path(sys.argv[2]).resolve()
        value = load_manifest(root)
        if mode == "contract":
            print(json.dumps({"incoming": value["backend_app_sha256"],
                              "baseline": value["baseline_backend_app_sha256"],
                              "alembic": value["alembic_sha256"]}))
        elif mode == "incoming":
            if not matches(root / "pwa", value["pwa_sha256"]):
                raise SystemExit("Incoming PWA checksum mismatch; upgrade stopped.")
            if not matches(root / "source/backend/app", value["backend_app_sha256"]):
                raise SystemExit("Incoming API/catalog checksum mismatch; upgrade stopped.")
            if not matches(root / "source/backend/alembic", value["alembic_sha256"]):
                raise SystemExit("Incoming migration checksum mismatch; upgrade stopped.")
            for name, digest in value["backend_launch_sha256"].items():
                path = root / "source/backend" / name
                if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise SystemExit("Incoming launch checksum mismatch; upgrade stopped.")
            metadata = json.loads((root / "pwa/version.json").read_text(encoding="utf-8"))
            if metadata["version"] != value["software_version"]:
                raise SystemExit("Incoming software version mismatch; upgrade stopped.")
            print("VERIFIED")
        else:
            web = Path(sys.argv[3])
            if web.is_symlink() or not web.is_dir():
                raise SystemExit("Expected existing PWA directory; upgrade stopped.")
            if matches(web, value["pwa_sha256"]):
                print("ALREADY")
            elif any(matches(web, item["pwa_sha256"]) for item in value["compatible_baselines"]):
                print("BASELINE")
            else:
                raise SystemExit(
                    "Installed PWA differs from verified releases; no files were replaced."
                )
        return
    if mode not in ("container", "image"):
        raise SystemExit("Unknown verification mode.")
    contract = json.loads(sys.argv[2])
    incoming = matches(Path.cwd() / "app", contract["incoming"])
    baseline = matches(Path.cwd() / "app", contract["baseline"])
    if mode == "image":
        if not incoming or not matches(Path.cwd() / "alembic", contract["alembic"]):
            raise SystemExit("Built image differs from API/catalog/migration contract.")
        print("VERIFIED")
        return
    state = database_state()
    if state == "ALREADY" and incoming:
        print("ALREADY")
    elif state == "ALREADY" and baseline:
        print("PATCH_BASELINE")
    else:
        raise SystemExit(
            "Patch requires the verified 0.7.2 API and receipt schema; upgrade stopped.")


if __name__ == "__main__":
    main()
