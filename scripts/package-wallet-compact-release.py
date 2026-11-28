"""Package the reviewed PWA and existing installer helpers from committed source."""
from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/wallet-compact-release"
TAG = "v0.16.0"
ARCHIVE = "wallet-0.16.0.tgz"
BASELINE_COMMIT = "7b4854a97ddaed345f073a23d422500ed6f28fc4"
BASELINE_MANIFEST_SHA = "6ff7d85556270f374f3332d6e5e0197829f8f6df86357be1afe76430aa48eada"


def sha(value):
    return hashlib.sha256(value).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def bootstrap(checksum):
    history = module("compact_history_package", "scripts/package-history-release.py")
    value = history.bootstrap(checksum).decode()
    value = value.replace("v0.15.1", TAG).replace("history-0.15.1", "wallet-0.16.0")
    return value.replace('"$release/upgrade-history.py"', '"$release/upgrade-wallet-compact.py"').encode()


def main():
    git = lambda *args: subprocess.check_output(["git", *args], cwd=ROOT)
    if git("status", "--porcelain").strip():
        raise ValueError("Commit reviewed release source before packaging")
    commit = git("rev-parse", "HEAD").decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE_COMMIT, commit], cwd=ROOT, check=True)
    if git("diff", "--name-only", BASELINE_COMMIT, "HEAD", "--", "backend/app", "backend/alembic", "backend/pyproject.toml",
           "backend/Dockerfile", "backend/ai_gateway", "backend/management-worker.py", "management-version.json", "src/features/management", "android", "site").strip():
        raise ValueError("PWA-only release cannot change API, schema, dependencies, management or Android")
    old_lock = json.loads(git("show", BASELINE_COMMIT + ":package-lock.json"))
    new_lock = load(ROOT / "package-lock.json")
    if load(ROOT / "package.json")["version"] != new_lock["version"] or new_lock["version"] != "0.16.0":
        raise ValueError("Source version differs")
    for lock in (old_lock, new_lock):
        lock.pop("version")
        lock["packages"][""].pop("version")
    if old_lock != new_lock:
        raise ValueError("Frontend dependencies changed")
    baseline_bytes = (OUTPUT / "baseline-validation.json").read_bytes()
    if sha(baseline_bytes) != BASELINE_MANIFEST_SHA:
        raise ValueError("Pinned published baseline manifest differs")
    baseline = json.loads(baseline_bytes)
    if baseline["source_commit"] != BASELINE_COMMIT or not load(OUTPUT / "baseline-check.json")["passed"]:
        raise ValueError("Baseline verification incomplete")
    for name in ("frontend", "copy", "build", "wallet", "history", "installer"):
        if load(OUTPUT / (name + "-result.json"))["exit_code"] != 0:
            raise ValueError("Validation failed: " + name)
    frontend = load(OUTPUT / "frontend-tests.json")
    wallet = load(ROOT / ".local-test/wallet-access-browser/results.json")
    history = load(ROOT / ".local-test/history-browser/result.json")
    if not frontend["success"] or frontend["numFailedTests"] or frontend["numFailedTestSuites"]:
        raise ValueError("Frontend regressions incomplete")
    for report, minimum in ((wallet, 21), (history, 5)):
        if (len(report["checks"]) < minimum or report["errors"] or report["externalRequests"]
                or report["productionWrites"] or report["manualWrites"]):
            raise ValueError("Browser verification incomplete")
    evidence = load(ROOT / "docs/wallet-0.16.0-validation.json")
    if not evidence["passed"] or evidence["frontend_passed"] != frontend["numPassedTests"]:
        raise ValueError("Validation evidence differs")
    files = {}
    for path in sorted((ROOT / "dist").rglob("*")):
        if path.is_symlink():
            raise ValueError("Linked PWA build output")
        if path.is_file():
            if path.suffix in {".map", ".db", ".sqlite", ".pem", ".key"} or path.name.startswith(".env"):
                raise ValueError("Private/debug build output")
            files["pwa/" + path.relative_to(ROOT / "dist").as_posix()] = path.read_bytes()
    if json.loads(files["pwa/version.json"])["version"] != "0.16.0":
        raise ValueError("PWA build version differs")
    for name, expected in baseline["pwa_sha256"].items():
        if name.startswith("meal-library/") and sha(files["pwa/" + name]) != expected:
            raise ValueError("Unrelated recipe corpus changed")
    javascript = b"\n".join(value for name, value in files.items() if name.endswith(".js"))
    if (b"https://api.khaanehyar.ir" not in javascript
            or any(value in javascript for value in (b"__COPY_PREVIEW__", b"data-copy-sources", b"127.0.0.1:5800", b"localhost:5701"))):
        raise ValueError("Production build contract differs")
    technical = [note["text"] for item in load(ROOT / "release-history.json")["releases"] for note in item["technical_notes"]]
    if any(text and text.encode() in javascript for text in technical):
        raise ValueError("Technical history leaked into public PWA")
    for name in ("upgrade-wallet-compact.py", "upgrade-history.py", "upgrade-home2.py", "home2-container.py",
                 "management/upgrade-analytics.py", "management/analytics-container.py", "management/upgrade-management-web.py"):
        files[name] = (ROOT / "backend/deploy" / name).read_bytes().replace(b"\r\n", b"\n")
    files["verification.json"] = (ROOT / "docs/wallet-0.16.0-validation.json").read_bytes()
    private = module("compact_secret_scan", "scripts/package-management-analytics.py").secret_values()
    for name, value in files.items():
        if name.endswith(".py"):
            compile(value, name, "exec")
        if (any(secret in value for secret in private)
                or re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}", value)):
            raise ValueError("Private runtime value detected")
    hashes = {name: sha(value) for name, value in files.items()}
    manifest = {"tag": TAG, "source_commit": commit, "software_version": "0.16.0", "management_version": "0.4.1",
        "baseline_tag": "v0.15.1", "baseline_commit": BASELINE_COMMIT, "deployment_scope": "pwa-only",
        "database_migration_required": False, "database_revision": "0042_meal_inventory_links",
        "files_sha256": hashes, "pwa_sha256": {name[4:]: value for name, value in hashes.items() if name.startswith("pwa/")},
        "baseline_pwa_sha256": baseline["pwa_sha256"], "baseline_web_sha256": baseline["web_sha256"],
        "container": baseline["container"], "management_source_sha256": baseline["management_source_sha256"],
        "dependencies_unchanged": True, "api_source_unchanged": True, "contains_credentials": False,
        "contains_real_data": False, "installed_on_server": False}
    metadata = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    files["validation.json"] = metadata
    content = io.BytesIO()
    with gzip.GzipFile(fileobj=content, mode="wb", mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w") as archive:
        for name, value in sorted(files.items()):
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(value), 0o644, 0
            archive.addfile(item, io.BytesIO(value))
    archive = content.getvalue()
    assets = {ARCHIVE: archive, "validation.json": metadata, "install.sh": bootstrap(sha(archive))}
    assets["SHA256SUMS"] = "".join(sha(value) + "  " + name + "\n" for name, value in assets.items()).encode()
    if (OUTPUT / "published.json").exists() and any((OUTPUT / name).read_bytes() != value for name, value in assets.items()):
        raise ValueError("Published package bytes cannot be changed")
    for name, value in assets.items():
        (OUTPUT / name).write_bytes(value)
    bash = str(Path(shutil.which("git")).resolve().parent.parent / "bin/bash.exe")
    subprocess.run([bash, "-n", str(OUTPUT / "install.sh")], check=True)
    installer = sha(assets["install.sh"])
    commands = ["curl -4fL --proto '=https' --proto-redir '=https' https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/v0.16.0/install.sh -o /root/wallet016.sh",
                "echo '" + installer + "  /root/wallet016.sh' | sha256sum -c - && bash /root/wallet016.sh"]
    if any(len(command) > 300 for command in commands):
        raise ValueError("VNC command exceeds limit")
    (OUTPUT / "install-commands.txt").write_text("\n\n".join(commands) + "\n", encoding="utf-8")
    print(json.dumps({"source_commit": commit, "files": len(files), "archive_bytes": len(archive),
        "archive_sha256": sha(archive), "installer_sha256": installer, "command_lengths": list(map(len, commands))}, indent=2))


if __name__ == "__main__":
    main()
