"""Build an immutable PWA-only release from the verified wallet baseline."""
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
OUTER = ROOT.parents[2]
OUTPUT = ROOT / ".local-test/quick-add-release"
TAG, ARCHIVE = "v0.17.0", "quick-add-0.17.0.tgz"
BASELINE_COMMIT = "b794b15ed29dd86a2d5d77830bf1917016508127"
spec = importlib.util.spec_from_file_location("quick_add_package_history", ROOT / "scripts/package-history-release.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
sha = common.sha


def bootstrap(checksum):
    original = common.TAG, common.ARCHIVE
    try:
        common.TAG, common.ARCHIVE = TAG, ARCHIVE
        text = common.bootstrap(checksum).decode()
    finally:
        common.TAG, common.ARCHIVE = original
    return text.replace("history-0.15.1", "quick-add-0.17.0").replace(
        '"$release/upgrade-history.py"', '"$release/upgrade-quick-add.py"').encode()


def baseline():
    return common.baseline(OUTPUT / "baseline", "wallet-0.16.0.tgz",
                           "4c3b0ec61e876516331e4a946ce47e2011cd880250a459de24b6cfae7bfcb033")


def main():
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise ValueError("Commit the reviewed source before packaging")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE_COMMIT, commit], cwd=ROOT, check=True)
    unchanged = subprocess.check_output(["git", "diff", "--name-only", BASELINE_COMMIT, "HEAD", "--",
        "backend/app", "backend/alembic", "backend/pyproject.toml", "backend/Dockerfile", "backend/management-worker.py", "backend/ai_gateway", "android", "site", "management-version.json", "src/features/management"], cwd=ROOT)
    if unchanged.strip():
        raise ValueError("PWA-only release cannot alter API, schema, management or other products")
    old_lock = json.loads(subprocess.check_output(["git", "show", BASELINE_COMMIT + ":package-lock.json"], cwd=ROOT))
    new_lock = json.loads((ROOT / "package-lock.json").read_bytes())
    if new_lock["version"] != "0.17.0" or json.loads((ROOT / "package.json").read_bytes())["version"] != "0.17.0":
        raise ValueError("Source version differs")
    for lock in (old_lock, new_lock):
        lock.pop("version"); lock["packages"][""].pop("version")
    if old_lock != new_lock:
        raise ValueError("Frontend dependencies changed")
    old = baseline()
    if old["source_commit"] != BASELINE_COMMIT or not json.loads((OUTPUT / "baseline-check.json").read_bytes())["passed"]:
        raise ValueError("Baseline verification incomplete")
    evidence = json.loads((ROOT / "docs/quick-add-release-validation.json").read_bytes())
    frontend = json.loads((ROOT / ".local-test/quick-add-frontend-tests.json").read_bytes())
    browser = json.loads((ROOT / ".local-test/quick-add-browser/result.json").read_bytes())
    if (not evidence["passed"] or evidence["release"] != TAG
            or evidence["baseline"]["source_commit"] != BASELINE_COMMIT
            or not frontend["success"] or frontend["numFailedTests"] or frontend["numFailedTestSuites"]):
        raise ValueError("Release validation incomplete")
    reports = [(browser, 19),
        (json.loads((ROOT / ".local-test/wallet-access-browser/results.json").read_bytes()), 21),
        (json.loads((ROOT / ".local-test/navigation-shell/results.json").read_bytes()), 15),
        (json.loads((ROOT / ".local-test/quick-add-built/result.json").read_bytes()), 3)]
    for report, minimum in reports:
        if (report.get("failure") or report["errors"] or report["externalRequests"]
                or report.get("productionWrites", 0) or report.get("manualWrites", 0)
                or len(report["checks"]) < minimum):
            raise ValueError("Merged quick-add/wallet/navigation/browser verification incomplete")
    files = common.collect_tree(ROOT / "dist", "pwa/")
    if json.loads(files["pwa/version.json"])["version"] != "0.17.0":
        raise ValueError("PWA build version differs")
    for name, expected in old["pwa_sha256"].items():
        if name.startswith("meal-library/") and sha(files["pwa/" + name]) != expected:
            raise ValueError("Unrelated recipe corpus changed")
    public = "\n".join(data.decode() for name, data in files.items() if name.endswith(".js"))
    technical = [note["text"] for item in json.loads((ROOT / "release-history.json").read_bytes())["releases"] for note in item["technical_notes"]]
    if ("https://api.khaanehyar.ir" not in public or "data-copy-sources" in public
            or any(text and text in public for text in technical)):
        raise ValueError("Expected production API and copy projection")
    for name in ("upgrade-quick-add.py", "upgrade-history.py", "upgrade-home2.py", "home2-container.py",
                 "management/upgrade-analytics.py", "management/analytics-container.py", "management/upgrade-management-web.py"):
        files[name] = (ROOT / "backend/deploy" / name).read_bytes().replace(b"\r\n", b"\n")
    files["verification.json"] = (ROOT / "docs/quick-add-release-validation.json").read_bytes()
    spec = importlib.util.spec_from_file_location("quick_add_secret_scan", ROOT / "scripts/package-management-analytics.py")
    scanner = importlib.util.module_from_spec(spec); spec.loader.exec_module(scanner)
    private = scanner.secret_values()
    for name, data in files.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
        if any(value in data for value in private) or re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}", data):
            raise ValueError("Private value detected")
    hashes = {name: sha(data) for name, data in files.items()}
    manifest = {"tag": TAG, "source_commit": commit, "software_version": "0.17.0", "management_version": "0.4.1",
        "baseline_tag": "v0.16.0", "baseline_commit": BASELINE_COMMIT, "deployment_scope": "pwa-only",
        "database_revision": "0042_meal_inventory_links", "database_migration_required": False,
        "files_sha256": hashes, "pwa_sha256": {name[4:]: value for name, value in hashes.items() if name.startswith("pwa/")},
        "baseline_pwa_sha256": old["pwa_sha256"], "baseline_web_sha256": old["baseline_web_sha256"],
        "retained_web_sha256": json.loads((OUTPUT / "retained-management-assets.json").read_bytes()),
        "container": old["container"], "management_source_sha256": old["management_source_sha256"],
        "dependencies_unchanged": True, "api_source_unchanged": True,
        "contains_credentials": False, "contains_real_data": False, "installed_on_server": False}
    metadata = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    files["validation.json"] = metadata
    content = io.BytesIO()
    with gzip.GzipFile(fileobj=content, mode="wb", mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w") as archive:
        for name, data in sorted(files.items()):
            entry = tarfile.TarInfo(name); entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
            archive.addfile(entry, io.BytesIO(data))
    archive = content.getvalue()
    assets = {ARCHIVE: archive, "validation.json": metadata, "install.sh": bootstrap(sha(archive))}
    assets["SHA256SUMS"] = "".join(sha(data) + "  " + name + "\n" for name, data in assets.items()).encode()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if (OUTPUT / "published.json").exists() and any((OUTPUT / name).read_bytes() != data for name, data in assets.items()):
        raise ValueError("Published assets are immutable")
    for name, data in assets.items():
        (OUTPUT / name).write_bytes(data)
    commands = ["curl -4fL --proto '=https' --proto-redir '=https' https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/v0.17.0/install.sh -o /root/quick017.sh",
        "echo '" + sha(assets["install.sh"]) + "  /root/quick017.sh' | sha256sum -c - && bash /root/quick017.sh"]
    if any(len(command) > 400 for command in commands):
        raise ValueError("VNC command too long")
    (OUTPUT / "install-commands.txt").write_text("\n\n".join(commands) + "\n", encoding="utf-8")
    print(json.dumps({"source_commit": commit, "archive_sha256": sha(archive), "installer_sha256": sha(assets["install.sh"]), "files": len(files), "command_lengths": list(map(len, commands))}, indent=2))


if __name__ == "__main__":
    main()
