"""Package checked web outputs and the existing installer helpers; no runtime data."""
from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTER = ROOT.parents[2]
OUTPUT = ROOT / ".local-test/history-release"
TAG = "v0.15.1"
ARCHIVE = "history-0.15.1.tgz"
BASELINE_COMMIT = "9467abe718e91ae3c9189e36bc51cd4e2a1e54dd"
REPOSITORY = "mojtabaaomidvar/FinanicalManagement"


def sha(value):
    return hashlib.sha256(value).hexdigest()


def baseline(folder, archive, expected):
    data = (folder / archive).read_bytes()
    if sha(data) != expected:
        raise ValueError("Published baseline archive differs")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as source:
        metadata = source.extractfile("validation.json").read()
    if metadata != (folder / "validation.json").read_bytes():
        raise ValueError("Baseline manifest differs from pinned archive")
    return json.loads(metadata)


def bootstrap(checksum):
    spec = importlib.util.spec_from_file_location("history_package_common", ROOT / "scripts/package-management-analytics.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.TAG, module.RELEASE_DIRECTORY = TAG, "history-0.15.1"
    value = module.bootstrap(checksum).decode().replace("management-0.3.0.tgz", ARCHIVE)
    value = value.replace("khaneyar-management-0.3.0.", "khaneyar-history-0.15.1.")
    value = value.replace('"$release/upgrade-analytics.py"', '"$release/upgrade-history.py"')
    value = value.replace("import hashlib, os, pathlib, sys, tarfile", "import hashlib, os, pathlib, sys, tarfile, tempfile")
    start = value.index("        target.mkdir(parents=True,mode=0o700)")
    end = value.index("\nEXTRACT", start)
    value = value[:start] + '''        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with tempfile.TemporaryDirectory(prefix='.history-extract-',dir=target.parent) as temporary:
            stage=pathlib.Path(temporary)/'files'
            stage.mkdir(mode=0o700)
            for m in items:
                p=stage/m.name
                p.parent.mkdir(parents=True,exist_ok=True)
                with p.open('xb') as out:
                    out.write(source.extractfile(m).read())
                p.chmod(0o644)
            stage.rename(target)''' + value[end:]
    return value.encode()


def collect_tree(root, prefix):
    result = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("Linked build output")
        if path.is_file():
            if path.suffix in {".map", ".db", ".sqlite", ".pem", ".key"} or path.name.startswith(".env"):
                raise ValueError("Private/debug file in build")
            result[prefix + path.relative_to(root).as_posix()] = path.read_bytes()
    return result


def main():
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise ValueError("Commit the reviewed release source before packaging")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE_COMMIT, commit], cwd=ROOT, check=True)
    unchanged = subprocess.check_output(["git", "diff", "--name-only", BASELINE_COMMIT, "HEAD", "--", "backend/app", "backend/alembic", "backend/pyproject.toml", "backend/ai_gateway", "android", "site"], cwd=ROOT)
    if unchanged.strip():
        raise ValueError("History release cannot replace API, schema, gateway, Android or marketing source")
    old = baseline(OUTER / ".local-test/release-wallet-v0.14.0/source/.local-test/wallet-access-release", "wallet-0.14.0.tgz",
                   "b746f71c95457ae8f6711beeb7bec5d3625def83694549041b08db4720519599")
    if (old["tag"], old["source_commit"]) != ("v0.14.0", BASELINE_COMMIT):
        raise ValueError("Unexpected published wallet baseline")
    management = baseline(OUTER / ".local-test/management-product-analytics/source/.local-test/management-analytics-release-r1", "management-0.3.0.tgz",
                          "7ca198814b6d52ec7d6bbfdca319d508422f3235181b3e47c3ea2a85af1adf60")
    frontend = json.loads((OUTPUT / "frontend-tests.json").read_bytes())
    browser = json.loads((ROOT / ".local-test/history-browser/result.json").read_bytes())
    mg = json.loads((OUTPUT / "management-browser.json").read_bytes())
    wallet = json.loads((ROOT / ".local-test/wallet-access-browser/results.json").read_bytes())
    evidence = json.loads((ROOT / "docs/history-release-validation.json").read_bytes())
    if not frontend["success"] or frontend["numFailedTests"] or browser["errors"] or browser["externalRequests"]:
        raise ValueError("Frontend/browser validation incomplete")
    if mg["consoleErrors"] or mg["pageErrors"] or mg["externalRequests"] or not evidence["passed"]:
        raise ValueError("Management validation incomplete")
    if len(wallet["checks"]) < 18 or wallet["errors"] or wallet["externalRequests"]:
        raise ValueError("Retained wallet behavior validation incomplete")
    files = collect_tree(ROOT / "dist", "pwa/") | collect_tree(ROOT / ".local-test/management-web", "web/")
    if (json.loads(files["pwa/version.json"])["version"], json.loads(files["web/version.json"])["version"]) != ("0.15.1", "0.4.1"):
        raise ValueError("Build versions differ")
    public = "\n".join(data.decode("utf-8") for name, data in files.items() if name.startswith("pwa/") and name.endswith(".js"))
    history = json.loads((ROOT / "release-history.json").read_bytes())
    technical = [note["text"] for item in history["releases"] for note in item["technical_notes"]]
    if ("https://api.khaanehyar.ir" not in public or "data-copy-sources" in public
            or any(text and text in public for text in technical)):
        raise ValueError("PWA projection or production build contract differs")
    for name in ("upgrade-history.py", "upgrade-home2.py", "home2-container.py", "management/upgrade-analytics.py",
                 "management/analytics-container.py", "management/upgrade-management-web.py"):
        files[name] = (ROOT / "backend/deploy" / name).read_bytes().replace(b"\r\n", b"\n")
    files["verification.json"] = (ROOT / "docs/history-release-validation.json").read_bytes()
    spec = importlib.util.spec_from_file_location("history_secret_scan", ROOT / "scripts/package-management-analytics.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    private = module.secret_values()
    for name, data in files.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
        if any(value in data for value in private) or re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}", data):
            raise ValueError("Private runtime value detected")
    hashes = {name: sha(data) for name, data in files.items()}
    subtree = lambda prefix: {name[len(prefix):]: value for name, value in hashes.items() if name.startswith(prefix)}
    manifest = {"tag": TAG, "source_commit": commit, "software_version": "0.15.1", "management_version": "0.4.1",
                "baseline_tag": "v0.14.0", "baseline_commit": BASELINE_COMMIT,
                "deployment_scope": "pwa-and-management-web-only", "database_migration_required": False,
                "database_revision": "0042_meal_inventory_links", "files_sha256": hashes,
                "pwa_sha256": subtree("pwa/"), "web_sha256": subtree("web/"),
                "baseline_pwa_sha256": old["pwa_sha256"], "baseline_web_sha256": management["web_sha256"],
                "container": old["container"], "management_source_sha256": management["management_source_sha256"],
                "installed_on_server": False, "contains_credentials": False, "contains_real_data": False}
    metadata = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    files["validation.json"] = metadata
    content = io.BytesIO()
    with gzip.GzipFile(fileobj=content, mode="wb", mtime=0) as compressed, \
            tarfile.open(fileobj=compressed, mode="w") as archive:
        for name, data in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
            archive.addfile(entry, io.BytesIO(data))
    archive = content.getvalue()
    assets = {ARCHIVE: archive, "validation.json": metadata, "install.sh": bootstrap(sha(archive))}
    assets["SHA256SUMS"] = "".join(sha(data) + "  " + name + "\n" for name, data in assets.items()).encode()
    if (OUTPUT / "published.json").exists() and any(
            (OUTPUT / name).read_bytes() != data for name, data in assets.items()):
        raise ValueError("Published package bytes cannot be changed")
    for name, data in assets.items():
        (OUTPUT / name).write_bytes(data)
    installer = sha(assets["install.sh"])
    commands = ["curl -4fL --proto '=https' --proto-redir '=https' https://github.com/" + REPOSITORY
                + "/releases/download/" + TAG + "/install.sh -o /root/history-0151.sh",
                "echo '" + installer + "  /root/history-0151.sh' | sha256sum -c - && bash /root/history-0151.sh"]
    if any(len(command) > 300 for command in commands):
        raise ValueError("VNC command exceeds the owner's limit")
    (OUTPUT / "install-commands.txt").write_text("\n\n".join(commands) + "\n", encoding="utf-8")
    print(json.dumps({"source_commit": commit, "files": len(files), "archive_bytes": len(archive),
                      "archive_sha256": sha(archive), "installer_sha256": installer, "command_lengths": list(map(len, commands))}, indent=2))


if __name__ == "__main__":
    main()
