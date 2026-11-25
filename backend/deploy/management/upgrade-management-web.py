"""Upgrade the checked management web directory; preserve the running service and identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = Path("/opt/khaneyar-management")
CONFIG = Path("/etc/khaneyar-management/config.json")
ORIGIN = "https://supp.khaanehyar.ir"


def checksum(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_tree(root: Path, hashes: dict[str, str]) -> None:
    if root.is_symlink() or not root.is_dir() or not hashes:
        raise ValueError("A required release directory is missing or is a link.")
    for name, expected in hashes.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
            raise ValueError("Invalid release file name.")
        path = root / name
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root.parent):
            raise ValueError("A release file path contains a link.")
        if not path.is_file() or checksum(path) != expected:
            raise ValueError("A release file differs from the checked manifest: " + name)
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    if actual != set(hashes):
        raise ValueError("Unexpected files exist in the web directory; they were retained.")


def probe(origin: str, expected_version: str) -> None:
    from urllib.parse import urlsplit

    hostname = urlsplit(origin).netloc
    for path in ("/management/version.json", "/management/api/session"):
        request = Request("http://127.0.0.1:5710" + path, headers={"Host": hostname})
        with urlopen(request, timeout=10) as response:  # noqa: S310 -- Fixed loopback HTTP path.
            value = json.load(response)
        if path.endswith("version.json"):
            if value.get("version") != expected_version:
                raise ValueError("The running service did not return the expected web version.")
        elif value.get("mode") != "production" or value.get("authenticated") is not False:
            raise ValueError("The running service is not an independent production session.")
    request = Request(
        "http://127.0.0.1:5710/management/api/state/analytics", headers={"Host": hostname}
    )
    try:
        with urlopen(request, timeout=10):  # noqa: S310 -- Fixed loopback HTTP path.
            pass
    except HTTPError as error:
        if error.code == 401:
            return
        raise
    raise ValueError("Analytics unexpectedly accepted an anonymous request.")


def apply(
    bundle: Path,
    *,
    base: Path = BASE,
    config_path: Path = CONFIG,
    check_service=probe,
) -> dict:
    manifest = json.loads((bundle / "validation.json").read_text(encoding="utf-8"))
    if manifest.get("tag") != "management-v0.2.0" or manifest.get("management_version") != "0.2.0":
        raise ValueError("Unexpected management release.")
    if config_path.is_symlink() or not config_path.is_file():
        raise ValueError("The existing management configuration is missing or is a link.")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    live = base / "web"
    if config.get("mode") != "production" or config.get("origin") != ORIGIN:
        raise ValueError("The existing installation is not the expected production support host.")
    if Path(config.get("web_root", "")) != live:
        raise ValueError("The existing web root differs; it was retained.")
    incoming = manifest["web_sha256"]
    retained = manifest["retained_asset_sha256"]
    if not all(name.startswith("assets/") for name in retained) or set(incoming) & set(retained):
        raise ValueError("Invalid retained asset manifest.")
    verify_tree(bundle / "web", incoming)
    runtime = base / "source/backend/app/management"
    for name, expected in manifest["baseline_runtime_sha256"].items():
        path = runtime / name
        if path.is_symlink() or not path.is_file() or checksum(path) != expected:
            raise ValueError("The installed management runtime differs; no update was applied.")
    version = json.loads((live / "version.json").read_text())["version"]
    combined = {**retained, **incoming}
    if version == "0.2.0":
        verify_tree(live, combined)
        check_service(config["origin"], "0.2.0")
        return {"updated": False, "version": version}
    if version != "0.1.0":
        raise ValueError("Only the checked management 0.1.0 installation can be upgraded.")
    verify_tree(live, manifest["baseline_web_sha256"])
    check_service(config["origin"], "0.1.0")
    backup_root = base / "web-backups"
    if backup_root.is_symlink():
        raise ValueError("The backup location is a link.")
    backup_root.mkdir(mode=0o700, exist_ok=True)
    backup_name = datetime.now(UTC).strftime("before-0.2.0-%Y%m%dT%H%M%S-") + os.urandom(4).hex()
    backup = backup_root / backup_name
    stage = Path(tempfile.mkdtemp(prefix=".web-stage-", dir=base))
    try:
        shutil.copytree(bundle / "web", stage, dirs_exist_ok=True)
        for name, expected in retained.items():
            if checksum(live / name) != expected:
                raise ValueError("An asset changed during preparation.")
            (stage / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(live / name, stage / name)
        for path in [stage, *stage.rglob("*")]:
            path.chmod(0o755 if path.is_dir() else 0o644)
        verify_tree(stage, combined)
        live.rename(backup)
        try:
            stage.rename(live)
            check_service(config["origin"], "0.2.0")
        except BaseException:
            if live.exists():
                live.rename(base / ("web-failed-" + os.urandom(4).hex()))
            backup.rename(live)
            raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {"updated": True, "version": "0.2.0", "backup": str(backup)}


if __name__ == "__main__":
    import fcntl

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run in the root server console.")
    with (BASE / ".web-upgrade.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = apply(arguments.bundle.resolve(strict=True))
    print("Management dashboard ready: " + ORIGIN + "/management/")
    print(json.dumps(result))
    print("The existing password, TOTP, accounts and sessions were preserved. Refresh the page.")
