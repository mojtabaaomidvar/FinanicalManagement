"""Prepare an allowlisted server package and a separate private server configuration."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "backend/app/__init__.py",
    "backend/app/core/__init__.py", "backend/app/core/errors.py", "backend/app/core/logging.py",
    "backend/app/services/__init__.py", "backend/app/services/sms_ai_protocol.py",
    "backend/app/services/sms_ai_provider.py",
    "backend/app/services/household_ai_protocol.py",
    "backend/ai_gateway/__init__.py", "backend/ai_gateway/app.py", "backend/ai_gateway/check.py",
    "backend/ai_gateway/requirements.txt", "backend/ai_gateway/Dockerfile",
    "backend/ai_gateway/Dockerfile.dockerignore", "backend/ai_gateway/compose.yml",
    "backend/ai_gateway/.env.example", "backend/ai_gateway/nginx-location.conf",
    "backend/ai_gateway/README.md",
    "backend/ai_gateway/install.py",
)


def vnc_command(content: bytes) -> str:
    encoded = base64.b64encode(content).decode("ascii")
    chunks = "\n".join(
        "    '" + encoded[index:index + 100] + "'" for index in range(0, len(encoded), 100)
    )
    digest = hashlib.sha256(content).hexdigest()
    return (
        "python3 - <<'KHANEYAR_GATEWAY_SETUP'\n"
        "import base64, hashlib, io, os, pathlib, subprocess, sys, tarfile, tempfile\n"
        "if os.geteuid() != 0: raise SystemExit('Run as root in the VNC console.')\n"
        "content = base64.b64decode(\n" + chunks + "\n)\n"
        f"if hashlib.sha256(content).hexdigest() != '{digest}':\n"
        "    raise SystemExit('Package checksum mismatch.')\n"
        "stage = pathlib.Path(tempfile.mkdtemp(prefix='khaneyar-ai-'))\n"
        "archive = stage / 'gateway.tgz'\n"
        "archive.write_bytes(content)\n"
        "with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as bundle:\n"
        "    installer = bundle.extractfile('backend/ai_gateway/install.py').read()\n"
        "setup = stage / 'install.py'\n"
        "setup.write_bytes(installer)\n"
        "raise SystemExit(subprocess.call(\n"
        "    [sys.executable, str(setup), str(archive), *sys.argv[1:]]))\n"
        "KHANEYAR_GATEWAY_SETUP\n"
    )


def main() -> None:
    sandbox = ROOT / ".local-test"
    if not sandbox.is_dir():
        raise RuntimeError("Start the local test environment first.")
    output = sandbox / "ai-gateway"
    output.mkdir(exist_ok=True)
    archive = output / "khaneyar-ai-gateway.tgz"
    for name in FILES:
        source = ROOT / name
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(ROOT):
            raise RuntimeError("A gateway source file is missing or linked outside the project.")
    with tarfile.open(archive, "w:gz") as package:
        for name in FILES:
            package.add(ROOT / name, arcname=name, recursive=False)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".tgz.sha256").write_text(
        digest + "  " + archive.name + "\n", encoding="utf-8",
    )
    (output / "vnc-install.txt").write_text(vnc_command(archive.read_bytes()), encoding="utf-8")
    script = vnc_command(archive.read_bytes()).split("\n", 1)[1].rsplit(
        "KHANEYAR_GATEWAY_SETUP", 1,
    )[0]
    (output / "vnc-installer.py").write_bytes(script.encode("utf-8"))
    print("Server package:", archive)
    print("SHA-256:", digest)
    if "--private-config" not in sys.argv:
        return
    private = output / "gateway.env"
    if private.exists():
        print("Existing private server configuration preserved:", private)
        return
    config_path = sandbox / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    key = str(config.get("DeepSeekApiKey", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{8,1024}", key):
        raise RuntimeError("Configure a DeepSeek key using configure-ai-test.bat first.")
    model = "deepseek-flash"
    if not re.fullmatch(r"[A-Za-z0-9_./:-]{1,160}", model):
        raise RuntimeError("The configured model identifier is invalid.")
    token = str(config.get("AiSmsGatewayToken", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        token = secrets.token_urlsafe(32)
        config["AiSmsGatewayToken"] = token
        handle, temporary = tempfile.mkstemp(prefix="ai-config-", dir=sandbox)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as target:
                json.dump(config, target, ensure_ascii=False, indent=2)
            os.replace(temporary, config_path)
        finally:
            Path(temporary).unlink(missing_ok=True)
    values = (
        f"DEEPSEEK_API_KEY={key}\nAI_GATEWAY_TOKEN={token}\nAI_SMS_MODEL={model}\n"
        "AI_SMS_TIMEOUT_SECONDS=25\nAI_GATEWAY_REQUESTS_PER_MINUTE=20\nAI_GATEWAY_CONCURRENCY=2\n"
    )
    descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        target.write(values)
    print("Private server configuration (separate from the package):", private)
    print("The gateway token is saved in the local test configuration.")
    print("After deployment, enter only the server URL in configure-ai-test.bat.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError):
        print(
            "Gateway preparation failed; check source files and private local test configuration.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
