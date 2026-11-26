"""Build a code-only, checksum-pinned API/management upgrade for the existing VPS."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAG = "management-v0.3.0"
OUTPUT = ROOT / ".local-test/management-analytics-release"
REPOSITORY = "mojtabaaomidvar/FinanicalManagement"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_tree(ref, prefix):
    archive = subprocess.run(["git", "archive", ref, prefix], cwd=ROOT, capture_output=True, check=True).stdout
    result = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for item in source:
            if item.isfile():
                data = source.extractfile(item).read()
                if Path(item.name).suffix in {".py", ".json", ".mako", ".ini", ".toml"}:
                    data = data.replace(b"\r\n", b"\n")
                result[item.name[len(prefix.rstrip("/")) + 1:]] = sha(data)
    return result


def add_tree(files, origin, prefix, suffixes=None):
    for path in sorted(origin.rglob("*")):
        if path.is_symlink():
            raise ValueError("Source contains a link")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
            if suffixes is None or path.suffix in suffixes:
                files[prefix + path.relative_to(origin).as_posix()] = path.read_bytes()


def secret_values():
    result = set()
    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if isinstance(item, str) and item and re.search(r"password|secret|apikey|token|encryption|salt", key, re.I):
                    result.add(item.encode())
                elif isinstance(item, (dict, list)):
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    for root in (ROOT, ROOT.parents[2]):
        config = root / ".local-test/config.json"
        if config.is_file():
            walk(json.loads(config.read_text(encoding="utf-8-sig")))
        for path in (root / "backend/.env", root / "backend/deploy/.env"):
            if path.is_file():
                for line in path.read_text(encoding="utf-8-sig").splitlines():
                    key, separator, value = line.partition("=")
                    if separator and re.search(r"PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL|SALT", key):
                        value = value.strip().strip("\"'")
                        if len(value) >= 8:
                            result.add(value.encode())
    return result


def bootstrap(checksum):
    return f'''#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || {{ echo 'Run as root in the VNC console.' >&2; exit 1; }}
for c in curl python3 sha256sum mktemp; do command -v "$c" >/dev/null; done
archive="$(mktemp /var/tmp/khaneyar-management-0.3.0.XXXXXXXX.tgz)"
trap 'rm -f -- "$archive"' EXIT
curl --ipv4 --fail --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 20 --max-time 300 \\
  'https://github.com/{REPOSITORY}/releases/download/{TAG}/management-0.3.0.tgz' --output "$archive"
printf '%s  %s\\n' '{checksum}' "$archive" | sha256sum --check -
python3 - "$archive" <<'EXTRACT'
import hashlib, os, pathlib, sys, tarfile
os.umask(0o077)
target=pathlib.Path('/opt/khaneyar-management/releases/analytics-0.3.0')
if any(p.is_symlink() for p in [target,*target.parents]):
    raise SystemExit('Linked release path; stopped.')
with tarfile.open(sys.argv[1],'r:gz') as source:
    items=source.getmembers()
    names=set()
    if len(items)>2000 or sum(m.size for m in items)>64*1024*1024:
        raise SystemExit('Unexpected archive size.')
    for m in items:
        p=pathlib.PurePosixPath(m.name)
        if not m.isfile() or p.is_absolute() or '..' in p.parts or '\\\\' in m.name or ':' in m.name or m.name in names or p.as_posix()!=m.name:
            raise SystemExit('Unsafe archive; stopped.')
        names.add(m.name)
    if target.exists():
        actual={{p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}}
        if actual != names or any(p.is_symlink() for p in target.rglob('*')):
            raise SystemExit('Retained release differs; stopped.')
        for m in items:
            if hashlib.sha256((target/m.name).read_bytes()).digest()!=hashlib.sha256(source.extractfile(m).read()).digest():
                raise SystemExit('Retained release checksum differs; stopped.')
    else:
        target.mkdir(parents=True,mode=0o700)
        for m in items:
            p=target/m.name
            p.parent.mkdir(parents=True,exist_ok=True)
            with p.open('xb') as out:
                out.write(source.extractfile(m).read())
            p.chmod(0o644)
EXTRACT
release=/opt/khaneyar-management/releases/analytics-0.3.0
exec python3 "$release/upgrade-analytics.py" "$release"
'''.encode()


def main():
    files = {}
    add_tree(files, ROOT / "backend/app", "api/app/", {".py", ".json"})
    add_tree(files, ROOT / "backend/alembic", "api/alembic/", {".py", ".mako"})
    for name in ("pyproject.toml", "alembic.ini"):
        files["api/" + name] = (ROOT / "backend" / name).read_bytes()
    files["api/Dockerfile"] = b'''ARG KHANEYAR_BASE
FROM ${KHANEYAR_BASE}
USER root
COPY --chown=10001:10001 app /app/app
COPY --chown=10001:10001 alembic /app/alembic
COPY --chown=10001:10001 alembic.ini /app/alembic.ini
USER appuser
'''
    for name in ("analytics-container.py", "upgrade-analytics.py"):
        files[name] = (ROOT / "backend/deploy/management" / name).read_bytes()
    files["verification.json"] = (ROOT / "docs/management-0.3.0-validation.json").read_bytes()
    add_tree(files, ROOT / "backend/app/management", "source/backend/app/management/", {".py"})
    for name in ("app/__init__.py", "app/core/__init__.py", "app/core/feature_policy.py", "management-worker.py"):
        files["source/backend/" + name] = (ROOT / "backend" / name).read_bytes()
    add_tree(files, ROOT / ".local-test/management-web", "web/")
    if json.loads(files["web/version.json"]).get("version") != "0.3.0":
        raise ValueError("Build the production management 0.3.0 web bundle first")
    hashes = {name: sha(data) for name, data in files.items()}
    subtree = lambda prefix: {name[len(prefix):]: checksum for name, checksum in hashes.items() if name.startswith(prefix)}
    baseline = git_tree("v0.11.0", "backend/app")
    with_management = git_tree("312f661", "backend/app")
    baseline_pyproject = subprocess.run(["git", "show", "v0.11.0:backend/pyproject.toml"],
                                        cwd=ROOT, capture_output=True, check=True).stdout
    if files["api/pyproject.toml"].replace(b"\r\n", b"\n") != baseline_pyproject.replace(b"\r\n", b"\n"):
        raise ValueError("An offline image upgrade cannot change dependencies")
    baseline_alembic = git_tree("v0.11.0", "backend/alembic")
    baseline_management = git_tree("312f661", "backend/app/management")
    baseline_worker = subprocess.run(["git", "show", "312f661:backend/management-worker.py"],
                                     cwd=ROOT, capture_output=True, check=True).stdout
    manifest = {
        "tag": TAG, "management_version": "0.3.0", "pwa_preserved_version": "0.12.0",
        "source_commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                         capture_output=True, text=True, check=True).stdout.strip(),
        "database_baseline_revision": "0037_wallet_corrections", "database_revision": "0039",
        "deployment_scope": "api-and-management-only", "database_migration_required": True,
        "files_sha256": hashes,
        "web_sha256": subtree("web/"), "management_source_sha256": subtree("source/"),
        "management_baseline_sha256": {**{"backend/app/management/" + name: value for name, value in baseline_management.items()},
                                       "backend/management-worker.py": sha(baseline_worker.replace(b"\r\n", b"\n"))},
        "container": {"app_sha256": {name[len("api/app/"):]: sha(data.replace(b"\r\n", b"\n")) for name, data in files.items() if name.startswith("api/app/")},
                      "alembic_sha256": {name[len("api/alembic/"):]: sha(data.replace(b"\r\n", b"\n")) for name, data in files.items() if name.startswith("api/alembic/")},
                      "baseline_alembic_sha256": baseline_alembic,
                      "baseline_app_variants": [baseline, with_management,
                                                {k: v for k, v in with_management.items() if not k.startswith("management/")}],
                      "pyproject_sha256": sha(baseline_pyproject.replace(b"\r\n", b"\n"))},
    }
    files["validation.json"] = json.dumps(manifest, sort_keys=True, indent=2).encode() + b"\n"
    secrets = secret_values()
    for name, data in files.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
        if any(secret in data for secret in secrets):
            raise ValueError("Private runtime data detected; packaging refused")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    content = io.BytesIO()
    with gzip.GzipFile(fileobj=content, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                archive.addfile(entry, io.BytesIO(data))
    archive_bytes = content.getvalue()
    (OUTPUT / "management-0.3.0.tgz").write_bytes(archive_bytes)
    (OUTPUT / "validation.json").write_bytes(files["validation.json"])
    (OUTPUT / "install.sh").write_bytes(bootstrap(sha(archive_bytes)))
    (OUTPUT / "SHA256SUMS").write_text("".join(
        sha((OUTPUT / name).read_bytes()) + "  " + name + "\n"
        for name in ("management-0.3.0.tgz", "validation.json", "install.sh")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "files": len(files), "bytes": len(archive_bytes),
                      "archive_sha256": sha(archive_bytes), "installer_sha256": sha((OUTPUT / "install.sh").read_bytes()),
                      "secret_scan": "passed"}, indent=2))


if __name__ == "__main__":
    main()
