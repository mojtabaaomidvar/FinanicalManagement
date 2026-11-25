"""Package the approved PWA-only 0.12.0 release from clean, committed source."""
import hashlib
import io
import json
import re
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/release-v0.12.0"
TAG = "v0.12.0"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    assert not git("status", "--porcelain").strip(), "Commit reviewed source before packaging."
    commit = git("rev-parse", "HEAD").decode().strip()
    baseline_dir = ROOT / ".local-test/release-v0.11.0"
    baseline = load(baseline_dir / "validation.json")
    assert baseline["tag"] == "v0.11.0" and baseline["commit"] == "b6ab5bffd63f42725c6d9faeb86e570e6e8ce8db"
    for line in (baseline_dir / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert sha((baseline_dir / name).read_bytes()) == digest, "Original release bytes differ."
    subprocess.run(["git", "merge-base", "--is-ancestor", baseline["commit"], commit], cwd=ROOT, check=True)
    assert not git("diff", "--name-only", baseline["commit"], commit, "--", "backend/app", "backend/alembic",
                   "backend/Dockerfile", "backend/pyproject.toml", "backend/alembic.ini", "backend/ai_gateway", "android", "site").strip()
    old_lock = json.loads(git("show", baseline["commit"] + ":package-lock.json"))
    new_lock = load(ROOT / "package-lock.json")
    assert load(ROOT / "package.json")["version"] == new_lock["version"] == "0.12.0"
    for lock in (old_lock, new_lock):
        lock.pop("version")
        lock["packages"][""].pop("version")
    assert old_lock == new_lock, "Dependencies must remain unchanged."
    frontend = load(OUTPUT / "frontend-tests.json")
    assert frontend["success"] and frontend["numFailedTests"] == 0
    copy_log = (OUTPUT / "copy.log").read_text(encoding="utf-8")
    installer_log = (OUTPUT / "installer.log").read_text(encoding="utf-8")
    build_log = (OUTPUT / "build.log").read_text(encoding="utf-8")
    copy_count = re.search(r"ℹ pass (\d+)", copy_log)
    installer_count = re.search(r"Ran (\d+) tests", installer_log)
    copy_texts = re.search(r"PASS: (\d+) editable UI texts; no unregistered display candidates\.", build_log)
    assert copy_count and installer_count and copy_texts
    for name in ("build", "copy", "installer", "wallet", "financial", "assistant"):
        assert load(OUTPUT / (name + "-result.json"))["exit_code"] == 0, name
    wallet = load(ROOT / ".local-test/wallet-integrity/result.json")
    assert len(wallet["checks"]) == 22 and not wallet["errors"] and not wallet["externalRequests"]
    assert wallet["productionWrites"] == wallet["manualWrites"] == 0
    financial = load(ROOT / ".local-test/financial-contract/results.json")
    assert len(financial["checks"]) == 3 and not financial["errors"] and not financial["externalRequests"]
    assistant = load(ROOT / ".local-test/household-assistant/results.json")
    assert len(assistant["checks"]) == 16 and not assistant["errors"] and not assistant["externalRequests"]
    evidence = {
        "passed": True, "frontend_passed": frontend["numPassedTests"],
        "frontend_suites": frontend["numPassedTestSuites"], "copy_studio_passed": int(copy_count.group(1)),
        "copy_editable_texts": int(copy_texts.group(1)), "installer_tests_passed": int(installer_count.group(1)),
        "wallet_browser_passed": len(wallet["checks"]), "financial_contract_browser_passed": len(financial["checks"]),
        "assistant_browser_passed": len(assistant["checks"]), "production_writes": wallet["productionWrites"],
        "manual_writes": wallet["manualWrites"], "build_warning": "existing application chunk exceeds 500 kB",
    }
    (OUTPUT / "verification.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    assert evidence["frontend_passed"] >= 971 and evidence["copy_studio_passed"] >= 139
    assert evidence["installer_tests_passed"] >= 25 and evidence["copy_editable_texts"] >= 5133
    data = git("-c", "core.autocrlf=false", "archive", "--format=tar", "--prefix=source/", commit)
    with tarfile.open(fileobj=io.BytesIO(data)) as source:
        entries = source.getmembers()
        assert all(item.isfile() or item.isdir() for item in entries)
        files = {item.name: source.extractfile(item).read() for item in entries if item.isfile()}
    for name, content in files.items():
        path = Path(name)
        assert not any(part in {".git", ".local-test", "node_modules", ".venv", "uploads"} for part in path.parts), name
        assert not path.name.startswith(".env") or path.name == ".env.example", name
        assert path.suffix.lower() not in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".jks", ".keystore", ".apk"}, name
        assert not re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{40,}|ghp_[A-Za-z0-9]{36}", content), name
        if name.endswith(".sh"):
            assert b"\r" not in content and not content.startswith(b"\xef\xbb\xbf"), name
    pwa = {path.relative_to(ROOT / "dist").as_posix(): path.read_bytes()
           for path in sorted((ROOT / "dist").rglob("*")) if path.is_file()}
    metadata = json.loads(pwa["version.json"])
    assert metadata["version"] == "0.12.0" and not any(name.endswith(".map") for name in pwa)
    javascript = b"\n".join(content for name, content in pwa.items() if name.endswith(".js"))
    assert all(marker in javascript for marker in (b"https://api.khaanehyar.ir", b"supp.khaanehyar.ir", b"X-Khaneyar-Money-Contract"))
    assert not any(marker in javascript for marker in (b"__COPY_PREVIEW__", b"data-copy-sources", b"127.0.0.1:5800", b"localhost:5701"))
    logos = {name: content for name, content in files.items() if name.startswith("source/public/bank-logos/") and name.endswith(".png")}
    assert len(logos) == 37
    for name, content in logos.items():
        public_name = name.removeprefix("source/public/")
        assert pwa[public_name] == content and public_name.encode() in pwa["sw.js"]
    manifest = {
        "tag": TAG, "software_version": "0.12.0", "commit": commit,
        "baseline_tag": baseline["tag"], "baseline_commit": baseline["commit"],
        "deployment_scope": "pwa-only", "database_migration_required": False,
        "database_revision_unchanged": "0037_wallet_corrections", "money_contract": "decimal-v1",
        "api": "https://api.khaanehyar.ir", "pwa_url": "https://pwa.khaanehyar.ir", "built_at_utc": metadata["buildTime"],
        "backend_app_unchanged": True, "dependencies_unchanged": True, "gateway_modified": False,
        "android_apk_included": False, "contains_credentials": False, "contains_real_data": False, "installed_on_server": False,
        "source_audit": {"passed": True, "changed_files": git("diff", "--name-only", baseline["commit"], commit).decode().splitlines()},
        "verification": evidence, "wallet_browser_passed": len(wallet["checks"]), "financial_contract_browser_passed": 3,
        "baseline_pwa_sha256": baseline["pwa_sha256"], "pwa_sha256": {name: sha(content) for name, content in pwa.items()},
        "validation_limits": ["Browser data is fictional and isolated; no real financial test writes",
                              "Physical-phone keyboard/Back and installed-PWA acceptance remain unverified",
                              "Installer failure scenarios use command doubles, not a production installation",
                              "Existing large application chunk warning remains"],
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    (OUTPUT / "validation.json").write_bytes(manifest_bytes)
    artifact = OUTPUT / ("khaneyar-" + TAG + ".tgz")
    assert not artifact.exists(), "Existing release artifact is immutable; inspect before retry."
    with tempfile.TemporaryDirectory(prefix="pwa-package-", dir=OUTPUT) as directory:
        staging = Path(directory)
        for name, content in {**files, **{"pwa/" + name: content for name, content in pwa.items()}}.items():
            path = staging / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        (staging / "validation.json").write_bytes(manifest_bytes)
        (staging / "release-tag.txt").write_bytes((TAG + "\n").encode())
        subprocess.run([sys.executable, str(staging / "source/backend/deploy/check-pwa-release.py"), "incoming", str(staging)], check=True)
        with tarfile.open(artifact, "w:gz") as archive:
            for item in entries:
                archive.addfile(item, io.BytesIO(files[item.name]) if item.isfile() else None)
            for path in sorted((staging / "pwa").rglob("*")):
                archive.add(path, arcname="pwa/" + path.relative_to(staging / "pwa").as_posix(), recursive=False)
            for name in ("validation.json", "release-tag.txt"):
                archive.add(staging / name, arcname=name)
    digest = sha(artifact.read_bytes())
    wrapper = f'''#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || {{ echo 'Run as root in the server console.' >&2; exit 1; }}
release_dir="$(mktemp -d /opt/khaneyar-pwa-release.XXXXXX)"
curl --ipv4 --retry 3 --connect-timeout 20 --max-time 300 --fail --location --proto '=https' --proto-redir '=https' \\
  'https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/{TAG}/khaneyar-{TAG}.tgz' --output "$release_dir/archive.tgz"
printf '%s  %s\\n' '{digest}' "$release_dir/archive.tgz" | sha256sum --check -
tar -xzf "$release_dir/archive.tgz" -C "$release_dir"
bash "$release_dir/source/backend/deploy/install-pwa-release.sh" "$release_dir"
'''
    (OUTPUT / "install.sh").write_bytes(wrapper.encode())
    bash = str(Path(shutil.which("git")).resolve().parent.parent / "bin/bash.exe") if sys.platform == "win32" else shutil.which("bash")
    subprocess.run([sys.executable, str(ROOT / "scripts/check-release-archive.py"), str(artifact), "--bash", bash,
                    "--installer", "source/backend/deploy/install-pwa-release.sh"], check=True)
    subprocess.run([bash, "-n", str(OUTPUT / "install.sh")], check=True)
    installer_sha = sha((OUTPUT / "install.sh").read_bytes())
    install_command = (
        "curl --ipv4 --fail --location --proto '=https' --proto-redir '=https' "
        "https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/v0.12.0/install.sh "
        "--output /tmp/khaneyar-v0.12.0-install.sh\n"
        "echo '" + installer_sha + "  /tmp/khaneyar-v0.12.0-install.sh' | sha256sum --check - "
        "&& bash /tmp/khaneyar-v0.12.0-install.sh"
    )
    (OUTPUT / "install-command.txt").write_text(install_command + "\n", encoding="utf-8", newline="\n")
    notes = f'''# KhanehYar 0.12.0

PWA-only wallet and currency-display refinement. The API, database, schema,
financial records, credentials, encryption keys, uploads, AI gateway and Android
package are unchanged. The installed PWA remains compatible with the existing
decimal-v1 API contract.

The new global rial/toman preference affects display only. Independent form
units convert only when their own unit control is selected. Account correction
history remains immutable; existing v0.11.0 files are checked and backed up
before the PWA-only swap.

Verification: {evidence['frontend_passed']} frontend tests, {evidence['copy_studio_passed']} copy-editor tests,
{evidence['wallet_browser_passed']} isolated wallet browser checks, {evidence['financial_contract_browser_passed']} financial contract checks,
{evidence['assistant_browser_passed']} assistant checks, {evidence['installer_tests_passed']} installer tests.
No production/manual financial records are created by fixture verification.
Physical-phone keyboard/Back and installed-PWA acceptance remain to be checked.

## نصب از کنسول سرور

این دو دستور را جداگانه اجرا کنید. دستور دوم ابتدا SHA-256 نصب‌کننده را بررسی
می‌کند و فقط پس از تطبیق، نصب‌کنندهٔ PWA را اجرا می‌کند:

```bash
{install_command.splitlines()[0]}
```

```bash
{install_command.splitlines()[1]}
```
'''
    (OUTPUT / "release-notes.md").write_text(notes, encoding="utf-8", newline="\n")
    (OUTPUT / "SHA256SUMS").write_bytes(("\n".join(sha((OUTPUT / name).read_bytes()) + "  " + name
                                                       for name in (artifact.name, "install.sh", "validation.json")) + "\n").encode())
    report = {"passed": True, "tag": TAG, "commit": commit, "archive_sha256": digest,
              "archive_bytes": artifact.stat().st_size, "pwa_files": len(pwa), "source_files": len(files),
              "installer_sha256": installer_sha, "installed_on_server": False}
    (OUTPUT / "package-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
