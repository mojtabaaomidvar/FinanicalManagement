"""Read-only checks for the exact inventory release and known server baseline."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

REVISION = "0033_inventory_categories"


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
            "v0.6.0", "0.6.0", "api-and-pwa", "0029", REVISION, True):
        raise SystemExit("Unexpected inventory release contract; no files were replaced.")
    return value


def database_state() -> str:
    from sqlalchemy import text

    from app.db.session import engine

    with engine.connect() as connection:
        connection.exec_driver_sql("SET TRANSACTION READ ONLY")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(text(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).one()
        if any(role) or revision not in ("0029", REVISION):
            raise SystemExit("Unexpected revision or unrestricted API role; upgrade stopped.")
        rls = connection.execute(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE oid='public.inventory_items'::regclass")).scalar_one()
        fields = set(connection.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='inventory_items'")).scalars())
        if not rls or (revision == "0029" and ("threshold" not in fields or "category" in fields)):
            raise SystemExit("Baseline inventory schema/RLS differs; upgrade stopped.")
        if revision == REVISION and ("threshold" in fields or "category" not in fields):
            raise SystemExit("Released inventory schema differs; upgrade stopped.")
        revision_trigger = connection.execute(text(
            "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.inventory_items'::regclass "
            "AND tgname='inventory_items_revision' AND NOT tgisinternal"
        )).scalar_one_or_none()
        if revision_trigger != "O":
            raise SystemExit("Inventory revision trigger differs; upgrade stopped.")
        if revision == REVISION:
            connection.execute(text("SELECT id FROM inventory_catalog_proposals LIMIT 0"))
    try:
        key = base64.b64decode(os.environ.get("DOCUMENT_ENCRYPTION_KEY", ""), validate=True)
    except (ValueError, TypeError):
        raise SystemExit("Existing encryption configuration is invalid; upgrade stopped.") from None
    if len(key) != 32:
        raise SystemExit("Existing encryption configuration is missing; upgrade stopped.")
    return "BASELINE" if revision == "0029" else "ALREADY"


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
    if state == "BASELINE" and incoming:
        print("READY")  # Resume after a transactionally rolled-back migration.
    elif (state == "BASELINE" and baseline) or (state == "ALREADY" and incoming):
        print(state)
    else:
        raise SystemExit("API source and schema do not match a known release; upgrade stopped.")


if __name__ == "__main__":
    main()
