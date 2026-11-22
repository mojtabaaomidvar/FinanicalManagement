"""Check Linux launch contracts using the exact bytes in a release archive."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--bash", default=shutil.which("bash"))
    parser.add_argument("--installer", default="source/backend/deploy/install-release.sh")
    args = parser.parse_args()
    if not args.bash:
        parser.error("Specify a Bash executable with --bash.")
    with tarfile.open(args.archive) as archive:
        scripts = [item for item in archive.getmembers() if item.isfile() and item.name.endswith(".sh")]
        if not scripts:
            raise RuntimeError("Archive has no shell scripts.")
        for item in scripts:
            data = archive.extractfile(item).read()
            if b"\r" in data or data.startswith(b"\xef\xbb\xbf"):
                raise RuntimeError("Linux shell script has CRLF or a BOM: " + item.name)
        tag = archive.extractfile("release-tag.txt").read()
        if not re.fullmatch(rb"[a-z0-9][a-z0-9._-]*\n", tag):
            raise RuntimeError("release-tag.txt must be one ASCII tag with an LF ending.")
        installer = archive.extractfile(args.installer).read()
    root = Path(__file__).resolve().parents[1]
    artifact_dir = (root / ".local-test").resolve()
    if root not in artifact_dir.parents:
        raise RuntimeError("Test artifact directory is outside the workspace.")
    artifact_dir.mkdir(exist_ok=True)
    # Run without a directory argument: this must reach the required-argument
    # check, before any server commands, configuration reads or filesystem writes.
    with tempfile.TemporaryDirectory(prefix="release-archive-check-", dir=artifact_dir) as temporary:
        if Path(temporary).resolve().parent != artifact_dir:
            raise RuntimeError("Unexpected temporary test directory.")
        path = Path(temporary) / "install-release.sh"
        path.write_bytes(installer)
        result = subprocess.run(
            [args.bash, path.as_posix()], cwd=temporary, capture_output=True, text=True,
            timeout=10, check=False,
        )
        if result.returncode == 0 or "Pass the extracted release directory" not in result.stderr:
            raise RuntimeError("Packaged installer failed its runtime preflight: " + result.stderr)
    print(f"PASS: {len(scripts)} shell scripts, LF release tag and installer runtime preflight.")


if __name__ == "__main__":
    main()
