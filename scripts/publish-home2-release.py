"""Publish the checked Home 2 installer for the owner's manual VNC installation."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("home2_publish_common", ROOT / "scripts/publish-management-analytics.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
common.DIRECTORY = ROOT / ".local-test/home2-release"
common.TAG = "v0.13.0"
common.ASSETS = ("home2-0.13.0.tgz", "validation.json", "install.sh", "SHA256SUMS")


def main():
    manifest, commit = common.verify()
    if sys.argv[1:] == ["--verify-only"]:
        print(json.dumps({"verified": True, "source_commit": commit,
                          "installer_sha256": common.sha((common.DIRECTORY / "install.sh").read_bytes())}))
        return
    if sys.argv[1:] or subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise ValueError("Use the clean, verified release source")
    github = common.GitHub()
    api = "https://api.github.com/repos/" + common.REPOSITORY
    code, release = github.request("GET", api + "/releases/tags/" + common.TAG)
    if code == 404:
        notes = (ROOT / "docs/deployment-home2-2026-11-27.md").read_text(encoding="utf-8")
        code, release = github.request("POST", api + "/releases", payload={
            "tag_name": common.TAG, "target_commitish": commit, "name": "KhanehYar 0.13.0 — Home 2",
            "draft": True, "prerelease": True, "make_latest": "false", "body": notes})
        if code != 201:
            raise RuntimeError("Release creation failed with HTTP " + str(code))
    elif code != 200:
        raise RuntimeError("Release lookup failed with HTTP " + str(code))
    if release.get("target_commitish") not in {commit, "codex/home2-install-0.13.0"}:
        raise ValueError("A different source owns the existing release; preserved")
    for name in common.ASSETS:
        existing = next((asset for asset in release.get("assets", []) if asset["name"] == name), None)
        expected = common.sha((common.DIRECTORY / name).read_bytes())
        if existing:
            if existing.get("digest") != "sha256:" + expected:
                raise ValueError("Existing release asset differs; preserved: " + name)
            continue
        if not release.get("draft"):
            raise ValueError("Refusing to alter a published release")
        code, asset = github.request("POST", release["upload_url"].split("{")[0] + "?name=" + quote(name),
                                     file=common.DIRECTORY / name)
        if code != 201 or asset.get("digest") != "sha256:" + expected:
            raise RuntimeError("Asset upload verification failed: " + name)
    if release.get("draft"):
        code, release = github.request("PATCH", api + "/releases/" + str(release["id"]),
                                       payload={"draft": False, "prerelease": True, "make_latest": "false"})
        if code != 200:
            raise RuntimeError("Release publication failed")
    base = "https://github.com/" + common.REPOSITORY + "/releases/download/" + common.TAG + "/"
    for name in common.ASSETS:
        code, data = github.request("GET", base + quote(name), public=True, binary=True)
        if code != 200 or common.sha(data) != common.sha((common.DIRECTORY / name).read_bytes()):
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
        print("Publication stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1) from None
