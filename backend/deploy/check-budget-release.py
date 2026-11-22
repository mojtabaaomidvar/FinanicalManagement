"""Verify this API/PWA release before replacing a known installation."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path


def matches(root: Path, hashes: dict[str, str], *, python_only: bool = False) -> bool:
    root = root.resolve()
    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*.py" if python_only else "*")
        if path.is_file() and "__pycache__" not in path.parts
    }
    if actual != set(hashes):
        return False
    for relative, expected in hashes.items():
        path = root / relative
        if root not in path.resolve().parents or path.is_symlink() or not path.is_file():
            return False
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            return False
    return True


def manifest(release: Path) -> dict:
    value = json.loads((release / "validation.json").read_text(encoding="utf-8"))
    if (
        value.get("tag") != "v0.5.0"
        or value.get("software_version") != "0.5.0"
        or value.get("deployment_scope") != "api-and-pwa"
        or value.get("database_revision") != "0029"
        or value.get("database_migration_required") is not False
    ):
        raise SystemExit("Unexpected budget release contract; no files were replaced.")
    return value


def check_database() -> None:
    from sqlalchemy import text

    from app.db.session import engine

    with engine.connect() as connection:
        connection.exec_driver_sql("SET TRANSACTION READ ONLY")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        role = connection.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).one()
        if revision != "0029" or any(role):
            raise SystemExit("Expected revision 0029 and the restricted API role; upgrade stopped.")
    try:
        key = base64.b64decode(os.environ.get("DOCUMENT_ENCRYPTION_KEY", ""), validate=True)
    except (ValueError, TypeError):
        raise SystemExit("Existing encryption configuration is invalid; upgrade stopped.") from None
    if len(key) != 32:
        raise SystemExit("Existing encryption configuration is missing; upgrade stopped.")


def main() -> None:
    mode = sys.argv[1]
    if mode in {"incoming", "contract", "pwa"}:
        release = Path(sys.argv[2]).resolve()
        value = manifest(release)
        if mode == "contract":
            print(json.dumps({
                "incoming": value["backend_app_sha256"],
                "baseline": value["baseline_backend_app_sha256"],
            }))
            return
        if mode == "incoming":
            if not matches(release / "pwa", value["pwa_sha256"]):
                raise SystemExit("Incoming PWA checksum mismatch; upgrade stopped.")
            if not matches(
                release / "source/backend/app", value["backend_app_sha256"], python_only=True
            ):
                raise SystemExit("Incoming API checksum mismatch; upgrade stopped.")
            metadata = json.loads((release / "pwa/version.json").read_text(encoding="utf-8"))
            if metadata["version"] != value["software_version"]:
                raise SystemExit("Incoming software version mismatch; upgrade stopped.")
            print("VERIFIED")
            return
        web = Path(sys.argv[3])
        if web.is_symlink() or not web.is_dir():
            raise SystemExit("Expected the existing PWA directory; upgrade stopped.")
        if matches(web, value["pwa_sha256"]):
            print("ALREADY")
        elif any(
            matches(web, item["pwa_sha256"]) for item in value["compatible_baselines"]
        ):
            print("BASELINE")
        else:
            raise SystemExit(
                "Installed PWA differs from verified releases; no files were replaced."
            )
        return
    if mode not in {"container", "image"}:
        raise SystemExit("Unknown release verification mode.")
    contract = json.loads(sys.argv[2])
    root = Path.cwd() / "app"
    if mode == "container":
        check_database()
    if matches(root, contract["incoming"], python_only=True):
        print("ALREADY" if mode == "container" else "VERIFIED")
    elif mode == "container" and matches(root, contract["baseline"], python_only=True):
        print("BASELINE")
    else:
        raise SystemExit("API source differs from verified releases; no files were replaced.")


if __name__ == "__main__":
    main()
