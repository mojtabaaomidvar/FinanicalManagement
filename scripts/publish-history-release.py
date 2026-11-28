"""Publish the verified history release for the owner's manual VNC execution."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("history_publish_common", ROOT / "scripts/publish-management-analytics.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
common.DIRECTORY = ROOT / ".local-test/history-release"
common.TAG = "v0.15.1"
common.ASSETS = ("history-0.15.1.tgz", "validation.json", "install.sh", "SHA256SUMS")


def main():
    _manifest, commit = common.verify()
    if sys.argv[1:] == ["--verify-only"]:
        print(json.dumps({"verified": True, "source_commit": commit,
                          "installer_sha256": common.sha((common.DIRECTORY / "install.sh").read_bytes())}))
        return
    if sys.argv[1:] or subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise ValueError("Use clean, committed release source")
    github = common.GitHub()
    api = "https://api.github.com/repos/" + common.REPOSITORY
    code, release = github.request("GET", api + "/releases/tags/" + common.TAG)
    if code == 404:
        notes = (ROOT / "docs/deployment-history-0.15.1.md").read_text(encoding="utf-8")
        code, release = github.request("POST", api + "/releases", payload={
            "tag_name": common.TAG, "target_commitish": commit, "name": "KhanehYar 0.15.1 / Management 0.4.1 — History after wallet update",
            "draft": True, "prerelease": False, "make_latest": "true", "body": notes})
        if code != 201:
            raise RuntimeError("Release creation failed with HTTP " + str(code))
    elif code != 200:
        raise RuntimeError("Release lookup failed with HTTP " + str(code))
    if release.get("target_commitish") != commit:
        raise ValueError("An existing release has another source; preserved")
    for name in common.ASSETS:
        existing = next((asset for asset in release.get("assets", []) if asset["name"] == name), None)
        expected = common.sha((common.DIRECTORY / name).read_bytes())
        if existing:
            if existing.get("digest") != "sha256:" + expected:
                raise ValueError("Existing asset differs; preserved: " + name)
            continue
        if not release.get("draft"):
            raise ValueError("Refusing to alter published assets")
        code, asset = github.request("POST", release["upload_url"].split("{")[0] + "?name=" + quote(name), file=common.DIRECTORY / name)
        if code != 201 or asset.get("digest") != "sha256:" + expected:
            raise RuntimeError("Asset verification failed: " + name)
    if release.get("draft"):
        code, release = github.request("PATCH", api + "/releases/" + str(release["id"]),
                                       payload={"draft": False, "prerelease": False, "make_latest": "true"})
        if code != 200:
            raise RuntimeError("Release publication failed")
    if release.get("draft") or release.get("prerelease"):
        raise ValueError("Release is not an official public release")
    base = "https://github.com/" + common.REPOSITORY + "/releases/download/" + common.TAG + "/"
    for name in common.ASSETS:
        code, content = github.request("GET", base + quote(name), public=True, binary=True)
        if code != 200 or common.sha(content) != common.sha((common.DIRECTORY / name).read_bytes()):
            raise RuntimeError("Public download verification incomplete: " + name)
    report = {"tag": common.TAG, "source_commit": commit, "url": release["html_url"],
              "installer_sha256": common.sha((common.DIRECTORY / "install.sh").read_bytes()),
              "archive_sha256": common.sha((common.DIRECTORY / common.ASSETS[0]).read_bytes()),
              "public_download_verified": True, "installed_on_server": False}
    (common.DIRECTORY / "published.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print("History publication stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1) from None
