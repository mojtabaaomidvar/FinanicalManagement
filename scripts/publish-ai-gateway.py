"""Publish only a verified code-only migration installer and verify its downloaded bytes."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import runpy
import sys
import tarfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def verified_source(directory: Path) -> bytes:
    source = (directory / "vnc-installer.py").read_bytes()
    compile(source, "migration-installer", "exec")
    package = runpy.run_path(str(ROOT / "scripts/package-ai-gateway.py"))
    content = (directory / "khaneyar-ai-gateway.tgz").read_bytes()
    expected = package["vnc_command"](content).split("\n", 1)[1].rsplit(
        "KHANEYAR_GATEWAY_SETUP", 1,
    )[0].encode()
    if source != expected:
        raise RuntimeError("Installer does not match the generated local archive.")
    confidential = list(strings(json.loads(
        (ROOT / ".local-test/config.json").read_text(encoding="utf-8-sig"),
    )))
    config = json.loads((ROOT / ".local-test/config.json").read_text(encoding="utf-8-sig"))
    credentials = [str(config.get(name, "")) for name in (
        "DeepSeekApiKey", "OpenRouterApiKey", "AiSmsGatewayToken", "AppPassword",
        "DocumentEncryptionKey", "FileSigningSecret", "RateLimitSalt",
    )]
    for path in (directory / "gateway.env", ROOT / "backend/.env"):
        if path.exists():
            confidential.extend(
                line.partition("=")[2].strip().strip("\"'")
                for line in path.read_text(encoding="utf-8-sig").splitlines()
                if "=" in line and not line.lstrip().startswith("#")
            )
    # Scan actual credentials, not short booleans, model IDs, URLs, or common configuration words.
    secrets = [value.encode() for value in confidential if len(value) >= 24
               and not value.startswith(("https://", "http://", "C:\\", "deepseek-"))]
    secrets.extend(value.encode() for value in credentials if value)
    allowed = set(package["FILES"])
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        members = archive.getmembers()
        if {item.name for item in members} != allowed or len(members) != len(allowed):
            raise RuntimeError("Archive allowlist does not match.")
        for item in members:
            if not item.isfile():
                raise RuntimeError("Archive contains an unsupported entry.")
            data = archive.extractfile(item).read()
            if any(secret in data or secret in source for secret in secrets):
                raise RuntimeError("Runtime credentials detected; publication refused.")
            if data != (ROOT / item.name).read_bytes():
                raise RuntimeError("Source changed since packaging; rebuild before publication.")
    # Check the embedded payload as well as the separately saved archive.
    match = re.search(rb"content = base64.b64decode\(\r?\n(.*?)\r?\n\)", source, re.DOTALL)
    if not match or base64.b64decode(b"".join(re.findall(
        rb"'([A-Za-z0-9+/=]+)'", match[1],
    ))) != content:
        raise RuntimeError("Embedded archive does not match.")
    return source


def main() -> None:
    if sys.argv[1:]:
        raise RuntimeError("No arguments are accepted; only DeepSeek migration is supported.")
    directory = ROOT / ".local-test/ai-gateway"
    source = verified_source(directory)
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        uploaded = client.post("https://paste.rs/", content=source, headers={
            "Content-Type": "text/plain; charset=utf-8",
        })
        if uploaded.status_code != 201:
            raise RuntimeError("The code-only upload did not succeed.")
        url = uploaded.text.strip()
        if not re.fullmatch(r"https://paste\.rs/[A-Za-z0-9]+", url):
            raise RuntimeError("The upload service returned an unexpected URL.")
        downloaded = client.get(url)
        if downloaded.status_code != 200 or downloaded.content != source:
            raise RuntimeError("Downloaded installer differs from the uploaded bytes.")
    state = {"url": url, "sha256": hashlib.sha256(source).hexdigest(), "code_only": True,
             "provider": "deepseek", "mode": "migrate-deepseek"}
    (directory / "vnc-deepseek-download.json").write_text(json.dumps(state), encoding="utf-8")
    (directory / "vnc-deepseek-download.txt").write_text(
        "curl -fsS " + url + " -o /tmp/ai.py\npython3 /tmp/ai.py --migrate-deepseek\n",
        encoding="utf-8",
    )
    print("Verified code-only DeepSeek migration installer:", url)
    print("SHA-256:", state["sha256"])


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, httpx.HTTPError, tarfile.TarError):
        print("Publication stopped; verify the source package and private configuration locally.",
              file=sys.stderr)
        raise SystemExit(1) from None
