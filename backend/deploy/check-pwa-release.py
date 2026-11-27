"""Read-only checks for approved PWA-only releases; no database or private settings."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


def manifest(release: Path) -> dict:
    value = json.loads((release / "validation.json").read_text(encoding="utf-8"))
    expected_baseline = {"v0.10.0": "v0.9.0", "v0.12.0": "v0.11.0"}.get(value.get("tag"))
    if (not expected_baseline or value.get("baseline_tag") != expected_baseline
            or value.get("deployment_scope") != "pwa-only"
            or value.get("database_migration_required") is not False):
        raise ValueError("Unexpected release contract; no files replaced.")
    if (release / "release-tag.txt").read_bytes() != (value["tag"] + "\n").encode():
        raise ValueError("Unexpected release tag.")
    for key in ("pwa_sha256", "baseline_pwa_sha256"):
        hashes = value[key]
        if not isinstance(hashes, dict) or not {"index.html", "sw.js", "version.json"} <= hashes.keys():
            raise ValueError("Incomplete PWA manifest.")
        for name, digest in hashes.items():
            path = PurePosixPath(name)
            if (path.is_absolute() or ".." in path.parts or str(path) != name
                    or "\\" in name or not re.fullmatch(r"[0-9a-f]{64}", digest)):
                raise ValueError("Unsafe PWA manifest entry.")
    return value


def verify_tree(root: Path, hashes: dict) -> None:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("PWA root must be an existing real directory.")
    entries = list(root.rglob("*"))
    if any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in entries):
        raise ValueError("Unexpected nonregular PWA entry.")
    actual = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in entries if path.is_file()}
    if actual != hashes:
        raise ValueError("PWA file inventory or checksums differ; unknown files are preserved.")


def installed(release: Path, web: Path) -> str:
    value = manifest(release)
    try:
        verify_tree(web, value["pwa_sha256"])
        return "ALREADY"
    except ValueError:
        verify_tree(web, value["baseline_pwa_sha256"])
        return "BASELINE"


def public(release: Path) -> int:
    value = manifest(release)
    for name, digest in value["pwa_sha256"].items():
        url = "https://pwa.khaanehyar.ir/" + urllib.parse.quote(name) + "?release=" + value["tag"]
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("Public PWA checksum differs: " + name)
    return len(value["pwa_sha256"])


def api_contract() -> None:
    # No bearer, body, real-data read or financial operation.
    for method, headers, expected in [
        ("GET", {"Origin": "https://pwa.khaanehyar.ir"}, 409),
        ("GET", {"Origin": "https://pwa.khaanehyar.ir", "X-Khaneyar-Money-Contract": "decimal-v1"}, 401),
        ("OPTIONS", {"Origin": "https://pwa.khaanehyar.ir", "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "X-Khaneyar-Money-Contract, Authorization, Content-Type"}, 200),
    ]:
        request = urllib.request.Request("https://api.khaanehyar.ir/api/v1/accounts", method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.status != expected or response.headers.get("Access-Control-Allow-Origin") != headers["Origin"]:
                raise ValueError("Existing API money contract/CORS differs; no API changes attempted.")
            if expected == 409 and (json.load(response).get("error") != "CLIENT_UPDATE_REQUIRED"
                                    or response.headers.get("Cache-Control") != "no-store"):
                raise ValueError("Existing API old-client gate differs.")
    print("API CONTRACT VERIFIED: existing decimal-v1/CORS/no-store; no financial data accessed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["incoming", "pwa", "baseline", "public", "version", "api"])
    parser.add_argument("release", type=Path)
    parser.add_argument("web", type=Path, nargs="?")
    args = parser.parse_args()
    value = manifest(args.release)
    if args.mode == "incoming":
        verify_tree(args.release / "pwa", value["pwa_sha256"])
        metadata = json.loads((args.release / "pwa/version.json").read_text())
        if metadata["version"] != value["tag"][1:]:
            raise ValueError("Unexpected software version.")
        print("VERIFIED")
    elif args.mode == "public":
        print("PUBLIC VERIFIED: " + str(public(args.release)) + " PWA files")
    elif args.mode == "version":
        print(value["tag"][1:])
    elif args.mode == "api":
        api_contract()
    else:
        if args.web is None:
            parser.error("Pass the existing web directory.")
        if args.mode == "baseline":
            verify_tree(args.web, value["baseline_pwa_sha256"])
            print("BASELINE VERIFIED")
        else:
            print(installed(args.release, args.web))


if __name__ == "__main__":
    main()
