"""Publish this checked code-only upgrade as a prerelease; never install on the VPS."""
from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / ".local-test/management-analytics-release-r1"
REPOSITORY = "mojtabaaomidvar/FinanicalManagement"
TAG = "management-v0.3.0-r1"
ASSETS = ("management-0.3.0.tgz", "validation.json", "install.sh", "SHA256SUMS")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify():
    manifest = json.loads((DIRECTORY / "validation.json").read_bytes())
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT, check=True).stdout.strip()
    if manifest.get("tag") != TAG or manifest.get("source_commit") != commit:
        raise ValueError("Rebuild the package at the reviewed source commit")
    with tarfile.open(DIRECTORY / ASSETS[0], "r:gz") as archive:
        items = archive.getmembers()
        expected = manifest["files_sha256"] | {"validation.json": sha((DIRECTORY / "validation.json").read_bytes())}
        if len(items) != len(expected) or {m.name for m in items} != set(expected):
            raise ValueError("Archive allowlist differs")
        for item in items:
            if not item.isfile() or sha(archive.extractfile(item).read()) != expected[item.name]:
                raise ValueError("Archive checksum differs")
    for line in (DIRECTORY / "SHA256SUMS").read_text().splitlines():
        expected_hash, name = line.split("  ", 1)
        if name not in ASSETS or sha((DIRECTORY / name).read_bytes()) != expected_hash:
            raise ValueError("Published checksum contract differs")
    bootstrap = (DIRECTORY / "install.sh").read_text()
    if sha((DIRECTORY / ASSETS[0]).read_bytes()) not in bootstrap:
        raise ValueError("Bootstrap is not pinned to this archive")
    return manifest, commit


class GitHub:
    def __init__(self):
        result = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                                capture_output=True, text=True, timeout=30, cwd=ROOT, check=True)
        credential = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        token = credential.get("password", "")
        if not token or any(c in token for c in '\r\n"\\'):
            raise ValueError("GitHub credential unavailable")
        self.config = ('header = "Authorization: Bearer ' + token + '"\n'
                       'header = "Accept: application/vnd.github+json"\n'
                       'header = "X-GitHub-Api-Version: 2022-11-28"\n').encode()

    def request(self, method, url, *, payload=None, file=None, public=False, binary=False):
        args = ["curl.exe", "--ipv4", "--silent", "--show-error", "--location",
                "--connect-timeout", "20", "--max-time", "180", "--request", method,
                "--write-out", "\n%{http_code}"]
        config = b"" if public else self.config
        if not public:
            args.extend(["--config", "-"])
        if payload is not None:
            path = DIRECTORY / ".github-release-request.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            args.extend(["--header", "Content-Type: application/json", "--data-binary", "@" + str(path)])
        if file is not None:
            args.extend(["--header", "Content-Type: application/octet-stream", "--data-binary", "@" + str(file)])
        if binary:
            args.extend(["--header", "Accept: application/octet-stream"])
        args.append(url)
        result = subprocess.run(args, input=config, capture_output=True, timeout=190, cwd=ROOT)
        if result.returncode:
            raise RuntimeError("GitHub transfer failed; no credentials printed")
        content, status = result.stdout.rsplit(b"\n", 1)
        code = int(status)
        if binary:
            return code, content
        try:
            value = json.loads(content)
        except ValueError:
            raise RuntimeError("Unexpected GitHub response") from None
        return code, value


def main():
    manifest, commit = verify()
    if sys.argv[1:] == ["--verify-only"]:
        print(json.dumps({"verified": True, "source_commit": commit,
                          "installer_sha256": sha((DIRECTORY / "install.sh").read_bytes())}))
        return
    if sys.argv[1:]:
        raise ValueError("Unsupported publication arguments")
    status = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    if status.strip():
        raise ValueError("Commit the reviewed worktree before publication")
    github = GitHub()
    api = "https://api.github.com/repos/" + REPOSITORY
    code, release = github.request("GET", api + "/releases/tags/" + TAG)
    if code == 404:
        code, release = github.request("POST", api + "/releases", payload={
            "tag_name": TAG, "target_commitish": commit,
            "name": "Management 0.3.0 r1 — portable API license verification",
            "draft": True, "prerelease": True, "make_latest": "false",
            "body": "Coordinated API and independent management upgrade from API v0.11.0 / schema 0037 and management 0.2.0. "
                    "Preserves the installed PWA 0.12.0, credentials, TOTP, private AI gateway and uploads. "
                    "Includes aggregate AI reporting, offline operation classification, feature/AI controls, Excel exports and configuration-file import.\n\n"
                    "Installer revision r1 normalizes CRLF/LF when checking the bundled Iranian banks LICENSE and includes that license in the replacement API source. "
                    "Uses a separate extracted-release directory; original published assets remain available.\n\n"
                    "Manual root-console installer checks source, backs up and rehearses restore/migration in a temporary database before additive 0038/0039 migrations. "
                    "No production database rollback/downgrade. After activation failure, services remain stopped and the same package can resume.\n\n"
                    "R1 validation: 18 installer tests, including three license regressions. Previous application validation for the unchanged application/web/migrations: "
                    "60 isolated PostgreSQL regressions, 136 management tests, 21 browser checks and 33 screenshots; "
                    "no browser console errors or external requests; 5967 editable texts covered. Linux Docker/systemd are explicit doubles in local lifecycle tests; "
                    "VPS acceptance is performed by the owner during manual installation. Publication is not installation.\n\n"
                    "Review verification.json and the deployment notes in the tagged source. Verify install.sh against SHA256SUMS before running it."})
        if code != 201:
            raise RuntimeError("Release creation failed with HTTP " + str(code))
    elif code != 200:
        raise RuntimeError("Release lookup failed with HTTP " + str(code))
    release_id = release["id"]
    for name in ASSETS:
        existing = next((asset for asset in release.get("assets", []) if asset["name"] == name), None)
        expected = sha((DIRECTORY / name).read_bytes())
        if existing:
            if existing.get("digest") != "sha256:" + expected:
                raise ValueError("An existing release asset differs; it was not overwritten")
            continue
        if not release.get("draft"):
            raise ValueError("Refusing to modify an already published release")
        code, asset = github.request("POST", release["upload_url"].split("{")[0] + "?name=" + quote(name), file=DIRECTORY / name)
        if code != 201 or asset.get("digest") != "sha256:" + expected:
            raise RuntimeError("Asset upload checksum verification failed")
    if release.get("draft"):
        code, release = github.request("PATCH", api + "/releases/" + str(release_id),
                                       payload={"draft": False, "prerelease": True, "make_latest": "false"})
        if code != 200:
            raise RuntimeError("Release publication failed")
    base = "https://github.com/" + REPOSITORY + "/releases/download/" + TAG + "/"
    for name in ASSETS:
        code, content = github.request("GET", base + quote(name), public=True, binary=True)
        if code != 200 or sha(content) != sha((DIRECTORY / name).read_bytes()):
            raise RuntimeError("Public asset verification failed: " + name)
    result = {"tag": TAG, "source_commit": commit, "url": release["html_url"],
              "installer_url": base + "install.sh", "installer_sha256": sha((DIRECTORY / "install.sh").read_bytes()),
              "archive_sha256": sha((DIRECTORY / ASSETS[0]).read_bytes()), "public_download_verified": True}
    (DIRECTORY / "published.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print("Publication stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1) from None
