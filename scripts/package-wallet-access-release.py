"""Package wallet 0.14.0 from the verified installed Home 2 release."""
from __future__ import annotations

import gzip
import importlib.util
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/wallet-access-release"
TAG = "v0.14.0"
BASELINE_COMMIT = "c2516e8078e9977989a750df0793c737cad8278f"
BASELINE_MANIFEST_SHA256 = "69041b62ae5feb05bf6652d807b248ed7e4666e2887dd96793cfc035d2a45e94"
REVISION = "0042_meal_inventory_links"
spec = importlib.util.spec_from_file_location("wallet_package_home", ROOT / "scripts/package-home2-release.py")
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
common = home.common


def bootstrap(checksum):
    value = home.bootstrap(checksum).decode()
    for old, new in {
        "v0.13.0": TAG, "home2-0.13.0": "wallet-0.14.0",
        "upgrade-home2.py": "upgrade-wallet.py",
    }.items():
        if old not in value:
            raise ValueError("Bootstrap template changed: " + old)
        value = value.replace(old, new)
    return value.encode()


def main():
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise ValueError("Commit the verified release source before packaging")
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE_COMMIT, "HEAD"], cwd=ROOT, check=True)
    baseline_bytes = (OUTPUT / "baseline-0.13.0.json").read_bytes()
    if common.sha(baseline_bytes) != BASELINE_MANIFEST_SHA256:
        raise ValueError("Published Home 2 manifest checksum differs")
    baseline = json.loads(baseline_bytes)
    if (baseline["tag"], baseline["source_commit"], baseline["database_revision"]) != (
            "v0.13.0", BASELINE_COMMIT, REVISION):
        raise ValueError("Unexpected installed source/schema baseline")
    if json.loads((ROOT / "package.json").read_text())["version"] != "0.14.0":
        raise ValueError("Unexpected package version")
    files = {}
    common.add_tree(files, ROOT / "backend/app", "api/app/", {".py", ".json"})
    files["api/app/data/iranian-banks/LICENSE"] = (ROOT / "backend/app/data/iranian-banks/LICENSE").read_bytes()
    common.add_tree(files, ROOT / "backend/alembic", "api/alembic/", {".py", ".mako"})
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
    if common.sha(files["api/pyproject.toml"].replace(b"\r\n", b"\n")) != baseline["container"]["pyproject_sha256"]:
        raise ValueError("Offline image update must preserve API dependencies")
    alembic = {name[len("api/alembic/"):]: common.sha(data.replace(b"\r\n", b"\n"))
               for name, data in files.items() if name.startswith("api/alembic/")}
    if alembic != baseline["container"]["alembic_sha256"]:
        raise ValueError("Wallet release must retain the exact installed migrations")
    for name in ("upgrade-wallet.py", "home2-container.py", "upgrade-home2.py",
                 "management/analytics-container.py", "management/upgrade-analytics.py"):
        files[name] = (ROOT / "backend/deploy" / name).read_bytes().replace(b"\r\n", b"\n")
    common.add_tree(files, ROOT / "dist", "pwa/")
    if json.loads(files["pwa/version.json"])["version"] != "0.14.0":
        raise ValueError("Build the versioned production PWA first")
    javascript = b"\n".join(data for name, data in files.items() if name.startswith("pwa/") and name.endswith(".js"))
    if any(marker in javascript for marker in (b"__COPY_PREVIEW__", b"data-copy-sources", b"localhost:5701", b"127.0.0.1:5800")):
        raise ValueError("Preview code must not enter the release")
    if any(marker not in javascript for marker in (b"https://api.khaanehyar.ir", b"X-Khaneyar-Money-Contract")):
        raise ValueError("Production API or money contract is missing")
    verification = json.loads((ROOT / "docs/wallet-0.14.0-validation.json").read_text())
    if verification.get("passed") is not True or verification.get("installed_on_server") is not False:
        raise ValueError("Release validation is incomplete")
    files["verification.json"] = json.dumps(verification, indent=2).encode() + b"\n"
    files["release-notes.md"] = (ROOT / "docs/deployment-wallet-0.14.0.md").read_bytes()
    hashes = {name: common.sha(data) for name, data in files.items()}
    manifest = {
        "tag": TAG, "software_version": "0.14.0", "management_preserved_version": "0.3.0",
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "baseline_source_commit": BASELINE_COMMIT,
        "baseline_manifest_sha256": BASELINE_MANIFEST_SHA256,
        "database_baseline_revision": REVISION, "database_revision": REVISION,
        "deployment_scope": "api-pwa-only", "database_migration_required": False,
        "management_modified": False, "gateway_modified": False, "android_modified": False,
        "contains_credentials": False, "contains_real_data": False, "installed_on_server": False,
        "money_contract": "decimal-v1", "files_sha256": hashes,
        "pwa_sha256": {name[len("pwa/"):]: value for name, value in hashes.items() if name.startswith("pwa/")},
        "baseline_pwa_sha256": baseline["pwa_sha256"],
        "container": {
            "app_sha256": {name[len("api/app/"):]: common.sha(data.replace(b"\r\n", b"\n"))
                           for name, data in files.items() if name.startswith("api/app/")},
            "alembic_sha256": alembic,
            "baseline_app_variants": [baseline["container"]["app_sha256"]],
            "baseline_alembic_sha256": baseline["container"]["alembic_sha256"],
            "pyproject_sha256": baseline["container"]["pyproject_sha256"],
        },
    }
    files["validation.json"] = json.dumps(manifest, sort_keys=True, indent=2).encode() + b"\n"
    secrets = common.secret_values()
    for name, data in files.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
        if any(secret in data for secret in secrets) or re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{40,}|ghp_[A-Za-z0-9]{36}", data):
            raise ValueError("Private material detected; packaging refused")
        if Path(name).suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".apk", ".map"}:
            raise ValueError("Private/runtime/debug file in package")
    content = io.BytesIO()
    with gzip.GzipFile(fileobj=content, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                archive.addfile(entry, io.BytesIO(data))
    outputs = {"wallet-0.14.0.tgz": content.getvalue(), "validation.json": files["validation.json"],
               "install.sh": bootstrap(common.sha(content.getvalue()))}
    for name, data in outputs.items():
        target = OUTPUT / name
        if target.exists() and target.read_bytes() != data:
            raise ValueError("Existing release bytes differ; preserved: " + name)
        target.write_bytes(data)
    (OUTPUT / "SHA256SUMS").write_text("".join(common.sha(data) + "  " + name + "\n" for name, data in outputs.items()), encoding="utf-8")
    url = "https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/" + TAG + "/install.sh"
    commands = ["curl -4fL --proto '=https' --proto-redir '=https' '" + url + "' -o /root/wallet014.sh",
                "echo '" + common.sha(outputs["install.sh"]) + "  /root/wallet014.sh' | sha256sum -c - && bash /root/wallet014.sh"]
    if any(len(command) > 300 for command in commands):
        raise ValueError("VNC command exceeds 300 characters")
    (OUTPUT / "install-commands.txt").write_text("\n\n".join(commands) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(files), "archive_bytes": len(content.getvalue()),
                      "archive_sha256": common.sha(content.getvalue()), "installer_sha256": common.sha(outputs["install.sh"]),
                      "vnc_command_lengths": list(map(len, commands)), "secret_scan": "passed"}, indent=2))


if __name__ == "__main__":
    main()
