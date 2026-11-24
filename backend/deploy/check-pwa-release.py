"""Read-only checks for the navigation PWA release; no database or private settings."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


def manifest(release: Path) -> dict:
    value = json.loads((release / "validation.json").read_text(encoding="utf-8"))
    if (value.get("tag") != "v0.10.0" or value.get("baseline_tag") != "v0.9.0"
            or value.get("deployment_scope") != "pwa-only"
            or value.get("database_migration_required") is not False):
        raise ValueError("Unexpected release contract; no files replaced.")
    if (release / "release-tag.txt").read_bytes() != b"v0.10.0\n":
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
        url = "https://pwa.khaanehyar.ir/" + urllib.parse.quote(name) + "?release=v0.10.0"
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("Public PWA checksum differs: " + name)
    return len(value["pwa_sha256"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["incoming", "pwa", "baseline", "public"])
    parser.add_argument("release", type=Path)
    parser.add_argument("web", type=Path, nargs="?")
    args = parser.parse_args()
    value = manifest(args.release)
    if args.mode == "incoming":
        verify_tree(args.release / "pwa", value["pwa_sha256"])
        metadata = json.loads((args.release / "pwa/version.json").read_text())
        if metadata["version"] != "0.10.0":
            raise ValueError("Unexpected software version.")
        print("VERIFIED")
    elif args.mode == "public":
        print("PUBLIC VERIFIED: " + str(public(args.release)) + " PWA files")
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
