"""Add the management route to the existing, known support nginx configuration."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

TARGET = Path("/etc/nginx/sites-available/khaneyar-support.conf")
LINK = Path("/etc/nginx/sites-enabled/khaneyar-support.conf")
SNIPPET = Path("/etc/nginx/snippets/khaneyar-management.conf")
INCLUDE = "include /etc/nginx/snippets/khaneyar-management.conf;"
ANCHOR = "    location ^~ /api/v1/support/ {"
ROUTES = """# KhanehYar independent management, shared support hostname.
location = /management { return 308 /management/; }
location ^~ /management/ {
    client_max_body_size 32k;
    access_log off;
    proxy_pass http://127.0.0.1:5710;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 180s;
    proxy_buffering off;
}
"""


def support_configuration(text: str) -> str:
    if not re.search(r"server_name\s+supp\.khaanehyar\.ir\s*;", text):
        raise ValueError("The existing support hostname was not found.")
    if text.count(ANCHOR) != 1:
        raise ValueError("The existing support API route requires review; no config was changed.")
    if INCLUDE in text:
        if text.count(INCLUDE) != 1 or "    " + INCLUDE + "\n" + ANCHOR not in text:
            raise ValueError("An existing management include requires review.")
        return text
    if re.search(r"location\b[^\n{};]*\/management\b", text):
        raise ValueError("An existing management route requires review.")
    return text.replace(ANCHOR, "    " + INCLUDE + "\n" + ANCHOR, 1)


def write(path: Path, content: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".management-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def check(target: Path = TARGET, link: Path = LINK, snippet: Path = SNIPPET) -> str:
    if target.is_symlink() or not target.is_file():
        raise ValueError("The expected support configuration is missing or is a symbolic link.")
    if not link.is_symlink() or link.resolve() != target.resolve():
        raise ValueError("The expected support configuration is not the enabled support site.")
    if snippet.is_symlink() or (snippet.exists() and snippet.read_text() != ROUTES):
        raise ValueError("An existing management snippet requires review.")
    return support_configuration(target.read_text(encoding="utf-8"))


def restore(state: Path, target: Path = TARGET, snippet: Path = SNIPPET) -> None:
    saved = json.loads((state / "before.json").read_text())
    write(target, (state / "support.conf").read_bytes(), saved["mode"])
    if saved["had_snippet"]:
        write(snippet, (state / "snippet.conf").read_bytes(), saved["snippet_mode"])
    else:
        snippet.unlink(missing_ok=True)


def activate(
    state: Path, target: Path = TARGET, link: Path = LINK, snippet: Path = SNIPPET
) -> None:
    changed = check(target, link, snippet)
    state.mkdir(mode=0o700, parents=True, exist_ok=False)
    saved = {
        "mode": target.stat().st_mode & 0o777,
        "had_snippet": snippet.exists(),
        "snippet_mode": snippet.stat().st_mode & 0o777 if snippet.exists() else 0o644,
    }
    write(state / "support.conf", target.read_bytes(), 0o600)
    if snippet.exists():
        write(state / "snippet.conf", snippet.read_bytes(), 0o600)
    write(state / "before.json", json.dumps(saved).encode(), 0o600)
    try:
        write(snippet, ROUTES.encode())
        write(target, changed.encode(), saved["mode"])
        subprocess.run(["/usr/sbin/nginx", "-t"], check=True)
    except BaseException:
        restore(state, target, snippet)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "activate", "restore"])
    parser.add_argument("state", nargs="?", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run in the server administrator console.")
    if args.action == "check":
        check()
    elif not args.state:
        raise SystemExit("Pass the private installation backup directory.")
    elif args.action == "activate":
        activate(args.state)
    else:
        restore(args.state)


if __name__ == "__main__":
    main()
