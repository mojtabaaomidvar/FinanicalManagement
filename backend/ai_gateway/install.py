"""Console installer: verified code via VNC, private settings through a hidden TTY prompt."""

from __future__ import annotations

import base64
import contextlib
import getpass
import http.client
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import warnings
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

ROOT = Path("/opt/khaneyar-ai-gateway")
NGINX = Path("/etc/nginx/sites-available/khaneyar.conf")
BACKUPS = Path("/var/backups/khaneyar/ai-gateway")
HOST = "api.khaanehyar.ir"
INCLUDE = "include /opt/khaneyar-ai-gateway/backend/ai_gateway/nginx-location.conf;"
PACKAGE_LIMIT = 512 * 1024
FILES = (
    "backend/app/__init__.py", "backend/app/core/__init__.py", "backend/app/core/errors.py",
    "backend/app/core/logging.py", "backend/app/services/__init__.py",
    "backend/app/services/sms_ai_protocol.py", "backend/app/services/sms_ai_provider.py",
    "backend/app/services/household_ai_protocol.py",
    "backend/ai_gateway/__init__.py", "backend/ai_gateway/app.py", "backend/ai_gateway/check.py",
    "backend/ai_gateway/requirements.txt", "backend/ai_gateway/Dockerfile",
    "backend/ai_gateway/Dockerfile.dockerignore", "backend/ai_gateway/compose.yml",
    "backend/ai_gateway/.env.example", "backend/ai_gateway/nginx-location.conf",
    "backend/ai_gateway/README.md", "backend/ai_gateway/install.py",
)
SYNTHETIC_BODY = {"items": [{
    "source_index": 0, "text": "واریز مبلغ ۱۰۰۰۰ ریال؛ موجودی ۵۰۰۰۰ ریال", "account_aliases": [],
}]}


class InstallError(RuntimeError):
    """Only fixed, non-sensitive installation diagnostics are printed."""


class OriginHTTPSConnection(http.client.HTTPSConnection):
    """Pin the diagnostic address to loopback, preserving hostname/SNI and verified TLS."""

    def connect(self) -> None:
        if self.host != HOST or self.port != 443:
            raise InstallError("Only the project's HTTPS origin may be diagnosed.")
        connection = socket.create_connection(("127.0.0.1", 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(connection, server_hostname=HOST)
        except Exception:
            connection.close()
            raise


class OriginHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        return self.do_open(OriginHTTPSConnection, request, context=self._context)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def private_settings(encoded: str) -> dict[str, str]:
    try:
        if len(encoded) > 8192:
            raise ValueError
        data = json.loads(base64.b64decode(encoded.strip(), validate=True))
        key, token, model = data["api_key"], data["token"], data["model"]
        if (
            not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{8,1024}", key)
            or not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token)
            or model != "deepseek-flash"
            or key.startswith("sk-or-")
        ):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise InstallError(
            "Private settings are invalid; copy them again from the local setup window."
        ) from None
    return {"api_key": key, "token": token, "model": model}


def api(path: str, *, key: str = "", body: dict | None = None,
        origin: bool = False) -> tuple[int, dict]:
    if path not in {
        "https://api.deepseek.com/models",
        "http://127.0.0.1:5810/healthz", "http://127.0.0.1:5810/v1/sms/analyze",
        f"https://{HOST}/ai-gateway/v1/sms/analyze",
        f"https://{HOST}/ai-gateway/v1/assistant/capabilities",
        f"https://{HOST}/ai-gateway/v1/assistant/analyze",
        f"https://{HOST}/ai-gateway/v1/assistant/plan",
        f"https://{HOST}/ai-gateway/v1/assistant/report",
    }:
        raise InstallError("Only the fixed provider and gateway endpoints may be checked.")
    if origin and path not in {
        f"https://{HOST}/ai-gateway/v1/sms/analyze",
        f"https://{HOST}/ai-gateway/v1/assistant/capabilities",
        f"https://{HOST}/ai-gateway/v1/assistant/analyze",
        f"https://{HOST}/ai-gateway/v1/assistant/plan",
        f"https://{HOST}/ai-gateway/v1/assistant/report",
    }:
        raise InstallError("Origin diagnostics are restricted to the fixed HTTPS gateway route.")
    headers = {"Accept": "application/json", "User-Agent": "KhanehYar-Gateway-Setup"}
    if key:
        headers["Authorization"] = "Bearer " + key
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(  # noqa: S310 - exact HTTP(S) endpoint allowlist above
        path, headers=headers, data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        if origin:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({}), OriginHTTPSHandler(), NoRedirectHandler(),
            )
            response = opener.open(request, timeout=5)
        else:
            timeout = 5 if path == f"https://{HOST}/ai-gateway/v1/sms/analyze" and not key else 35
            response = urllib.request.build_opener(NoRedirectHandler()).open(
                request, timeout=timeout,
            )
        with response:
            content = response.read(1024 * 1024 + 1)
            if len(content) > 1024 * 1024:
                raise InstallError("Network check returned an oversized response.")
            payload = json.loads(content) if content else {}
            if not isinstance(payload, dict):
                raise InstallError("Network check returned an invalid response.")
            return response.status, payload
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read(65536))
            return error.code, payload if isinstance(payload, dict) else {}
        except (OSError, ValueError):
            return error.code, {}
        finally:
            error.close()
    except (OSError, ValueError):
        raise InstallError("The server could not complete the network check.") from None


def check_provider(config: dict[str, str]) -> None:
    status, payload = api("https://api.deepseek.com/models", key=config["api_key"])
    print("DeepSeek authenticated model list HTTP:", status, flush=True)
    if status != 200:
        raise InstallError("DeepSeek did not accept the connection/key; installation stopped.")
    items = payload.get("data", [])
    if not isinstance(items, list) or not any(
        isinstance(item, dict) and item.get("id") == config["model"] for item in items
    ):
        raise InstallError("The approved DeepSeek model is not listed; no fallback was attempted.")


def archive_files(content: bytes) -> dict[str, bytes]:
    if len(content) > PACKAGE_LIMIT:
        raise InstallError("Gateway package is too large.")
    result = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if (
                not member.isfile() or path.is_absolute() or ".." in path.parts
                or "\\" in member.name or not member.name.startswith("backend/")
                or member.name not in FILES or member.name in result
            ):
                raise InstallError("Gateway archive contains an unsupported path or entry.")
            total += member.size
            if total > PACKAGE_LIMIT:
                raise InstallError("Expanded gateway package is too large.")
            result[member.name] = archive.extractfile(member).read()
    for required in FILES:
        if required not in result:
            raise InstallError("Gateway package is incomplete.")
    return result


def add_nginx_route(source: str) -> str:
    """Find the existing API TLS block while ignoring comments and quoted braces."""
    masked = list(source)
    quote = ""
    comment = False
    escaped = False
    token_start = True
    for index, character in enumerate(source):
        if comment:
            if character == "\n":
                comment = False
                token_start = True
            else:
                masked[index] = " "
        elif escaped:
            masked[index] = " "
            escaped = False
            token_start = False
        elif character == "\\":
            masked[index] = " "
            escaped = True
            token_start = False
        elif quote:
            masked[index] = " "
            if character == quote:
                quote = ""
        elif character in "\"'":
            masked[index] = " "
            quote = character
            token_start = False
        elif character == "#" and token_start:
            # nginx starts comments between tokens; /download/#ios is one URL token.
            masked[index] = " "
            comment = True
        else:
            token_start = character.isspace() or character in ";{}"
    clean = "".join(masked)
    candidates = []
    for match in re.finditer(r"\bserver\s*\{", clean):
        depth, end = 1, match.end()
        while end < len(clean) and depth:
            depth += (clean[end] == "{") - (clean[end] == "}")
            end += 1
        if depth:
            raise InstallError("The existing nginx configuration must be checked manually.")
        body = clean[match.end():end - 1]
        if (
            re.search(r"\bserver_name\s+[^;]*\b" + re.escape(HOST) + r"(?:\s|;)", body)
            and re.search(r"\blisten\s+[^;]*\b443\b[^;]*;", body)
        ):
            candidates.append((match.end(), end - 1))
    if len(candidates) != 1:
        raise InstallError("Expected one existing API HTTPS block; nginx was not changed.")
    start, end = candidates[0]
    if INCLUDE in source[start:end]:
        return source
    if "location = /ai-gateway/v1/sms/analyze" in source[start:end]:
        raise InstallError("An existing AI gateway route must be reviewed before replacement.")
    return source[:start] + "\n    " + INCLUDE + "\n" + source[start:]


def write(path: Path, content: bytes, mode: int = 0o600) -> None:
    if path.is_symlink():
        raise InstallError("Installation refuses an unexpected linked file.")
    temporary = path.with_name(path.name + ".next")
    if temporary.exists() or temporary.is_symlink():
        raise InstallError("A previous temporary file must be reviewed before retrying.")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run(command: list[str], cwd: Path | None = None) -> None:
    # Suppress arbitrary Docker/environment output, including errors containing credentials.
    capture(command, cwd, timeout=600 if "build" in command else 90)


def saved_settings(gateway: Path) -> tuple[dict[str, str], bytes]:
    marker = ROOT / ".gateway-installer"
    path = gateway / ".env"
    for directory in (ROOT, ROOT / "backend", gateway):
        if directory.is_symlink():
            raise InstallError("Saved gateway settings cannot be read through linked directories.")
    if (
        marker.is_symlink() or not marker.is_file() or path.is_symlink()
        or not path.is_file() or path.stat().st_size > 8192
    ):
        raise InstallError("Migration requires the existing managed gateway and private settings.")
    content = path.read_bytes()
    values = {}
    for line in content.decode("utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or name in values:
            raise InstallError("Saved gateway settings need manual review; they were preserved.")
        values[name] = value
    token = values.get("AI_GATEWAY_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        raise InstallError("Saved gateway token needs manual review; settings preserved.")
    return {"api_key": "", "token": token, "model": "deepseek-flash"}, content


def hidden_input(prompt: str) -> str:
    """getpass normally falls back to echoing stdin; that is forbidden for credentials."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            return getpass.getpass(prompt)
    except (getpass.GetPassWarning, EOFError, OSError):
        raise InstallError(
            "A hidden terminal input is required; no credentials were read.",
        ) from None


def upgrade_settings(gateway: Path) -> tuple[dict[str, str], bytes]:
    """Read the already-deployed key privately, without asking for a replacement."""
    config, content = saved_settings(gateway)
    values = dict(line.partition("=")[::2] for line in content.decode("utf-8").splitlines()
                  if line.strip() and not line.lstrip().startswith("#"))
    key = values.get("DEEPSEEK_API_KEY", "")
    if (not re.fullmatch(r"[A-Za-z0-9_.-]{8,1024}", key) or key.startswith("sk-or-")
            or values.get("AI_SMS_MODEL", "deepseek-flash") != "deepseek-flash"):
        raise InstallError("Assistant upgrade requires the existing approved DeepSeek settings.")
    return {**config, "api_key": key}, content


@contextlib.contextmanager
def installation_lock():
    import fcntl  # Linux-only console installer; application runtime does not import it.

    path = ROOT.parent / ".khaneyar-ai-gateway-install.lock"
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise InstallError(
                "Another gateway installer is active; installation stopped.",
            ) from None
        yield
    finally:
        os.close(descriptor)


def capture(command: list[str], cwd: Path | None = None, timeout: int = 30) -> str:
    environment = {
        name: value for name, value in os.environ.items()
        if not name.startswith("COMPOSE_") and name != "AI_GATEWAY_IMAGE"
    }
    if command[:2] == ["docker", "compose"] and cwd is not None:
        # Neither a shell COMPOSE_FILE/project nor an exported image may redirect this installer.
        files = [] if "-f" in command else ["-f", str(cwd / "compose.yml")]
        command = [*command[:2], "--project-name", "khaneyar-ai-gateway",
                   "--env-file", str(cwd / ".env"), *files, *command[2:]]
    try:
        result = subprocess.run(  # noqa: S603 - fixed operations; credentials only in env files
            command, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=environment,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise InstallError(
            "A bounded gateway command did not complete; private output hidden.",
        ) from None
    if result.returncode:
        if "ai_gateway.check" in command:
            print_check_diagnostics(result.stdout)
        raise InstallError("A gateway command failed; private command output was not printed.")
    return result.stdout


def print_check_diagnostics(output: str) -> None:
    for line in output.splitlines():
        if re.fullmatch(r"DeepSeek authenticated model list HTTP: [0-9]{3}", line) or line in {
            "Configured model is listed: False", "Synthetic SMS analysis is accurate: False",
            "The server could not complete the DeepSeek connectivity check.",
        }:
            print(line, flush=True)
        elif line.startswith("{"):
            try:
                error = json.loads(line)
                code = error.get("error")
                if code in {
                    "AI_PROVIDER_KEY_REJECTED", "AI_PROVIDER_CREDIT_REQUIRED", "AI_ACCESS_DENIED",
                    "AI_MODEL_UNAVAILABLE", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_TIMEOUT",
                    "AI_CONNECTION_FAILED", "AI_INVALID_RESULT", "AI_PROVIDER_INVALID_REQUEST",
                    "AI_UNAVAILABLE", "AI_NOT_CONFIGURED",
                }:
                    print("DeepSeek candidate error:", code, flush=True)
            except (ValueError, AttributeError, TypeError):
                pass


def current_image(gateway: Path) -> str:
    identifier = capture(["docker", "compose", "ps", "--status", "running", "--quiet", "gateway"],
                         gateway).strip()
    if not re.fullmatch(r"[a-f0-9]{12,64}", identifier):
        raise InstallError("Migration requires exactly one running managed gateway.")
    # Never print inspect output: it contains the old provider key and private token.
    details = json.loads(capture(["docker", "inspect", identifier]))
    if not isinstance(details, list) or len(details) != 1:
        raise InstallError("The managed gateway identity could not be verified.")
    container = details[0]
    labels = container.get("Config", {}).get("Labels", {})
    image = container.get("Image", "")
    if (
        labels.get("com.docker.compose.project") != "khaneyar-ai-gateway"
        or labels.get("com.docker.compose.service") != "gateway"
        or not container.get("State", {}).get("Running")
        or not re.fullmatch(r"sha256:[a-f0-9]{64}", image)
        or container.get("HostConfig", {}).get("PortBindings", {}).get("8000/tcp")
        != [{"HostIp": "127.0.0.1", "HostPort": "5810"}]
    ):
        raise InstallError("The running service is not the expected private managed gateway.")
    return image


def snapshot(names: list[str]) -> dict[str, bytes | None]:
    result = {}
    for name in names:
        path = ROOT / name
        for parent in (path, *path.parents):
            if parent.is_symlink():
                raise InstallError("Migration refuses linked files or directories.")
            if parent == ROOT:
                break
        if path.exists() and not path.is_file():
            raise InstallError("A managed file path is not a regular file.")
        result[name] = path.read_bytes() if path.exists() else None
    return result


def updated_env(saved: bytes, config: dict[str, str], image: str) -> bytes:
    updates = {
        "DEEPSEEK_API_KEY": config["api_key"], "AI_SMS_MODEL": "deepseek-flash",
        "AI_GATEWAY_IMAGE": image,
    }
    lines = []
    for line in saved.decode("utf-8").splitlines():
        name = line.partition("=")[0]
        if name == "OPENROUTER_API_KEY":
            continue  # Remove only the active old key; protected backups are left intact.
        if name in updates:
            line = name + "=" + updates.pop(name)
        lines.append(line)
    lines.extend(name + "=" + value for name, value in updates.items())
    return ("\n".join(lines) + "\n").encode()


def migrate(files: dict[str, bytes], gateway: Path, config: dict[str, str], saved_env: bytes,
            before: bytes, proposed: str, *, household: bool = False) -> None:
    names = [*files, "backend/ai_gateway/.env", ".gateway-installer"]
    original = snapshot(names)
    if original["backend/ai_gateway/.env"] != saved_env:
        raise InstallError("Settings changed before migration; concurrent edits preserved.")
    old_image = current_image(gateway)
    for directory in (BACKUPS, *BACKUPS.parents):
        if directory.is_symlink():
            raise InstallError("Private backup directories must not be linked.")
    BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BACKUPS, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")  # noqa: UP017
    candidate = "khaneyar-ai-gateway:deepseek-" + stamp
    rollback_image = "khaneyar-ai-gateway:rollback-" + stamp
    replacement = saved_env if household else updated_env(saved_env, config, candidate)
    if household:
        # Pin the prepared image in the managed compose file, not in private settings.
        # The existing .env (including comments, line endings and old image setting)
        # remains byte-for-byte untouched, and later compose restarts use this image.
        name = "backend/ai_gateway/compose.yml"
        marker = b"    image: ${AI_GATEWAY_IMAGE:-khaneyar-ai-gateway-gateway}"
        if files[name].count(marker) != 1:
            raise InstallError("Assistant upgrade requires the expected managed compose image.")
        files = {**files, name: files[name].replace(marker, b"    image: " + candidate.encode())}
    # Staging never writes live paths, publishes a port, or reuses the running image tag.
    with tempfile.TemporaryDirectory(prefix="deepseek-stage-", dir=BACKUPS) as temporary:
        stage = Path(temporary)
        for name, content in files.items():
            destination = stage / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            write(destination, content, 0o644)
        private = stage / "candidate.env"
        write(private, replacement)
        print("Building isolated DeepSeek candidate; current gateway remains running.", flush=True)
        capture(["docker", "build", "-t", candidate, "-f",
                 str(stage / "backend/ai_gateway/Dockerfile"), str(stage / "backend")], timeout=600)
        print("Checking candidate key/model and one synthetic analysis (billable).", flush=True)
        diagnostic = capture([
            "docker", "run", "--rm", "--env-file", str(private), "--read-only",
            "--tmpfs", "/tmp:size=16m,mode=1777", "--cap-drop=ALL",  # noqa: S108 - container tmpfs
            "--security-opt=no-new-privileges:true", "--memory=256m", "--cpus=1",
            "--entrypoint", "python", candidate, "-m", "ai_gateway.check", "--analyze",
        ], timeout=90)
        if "DEEPSEEK READY: configured key and model verified." not in diagnostic.splitlines():
            raise InstallError("DeepSeek candidate verification failed; live gateway unchanged.")
    if (
        snapshot(names) != original or NGINX.read_bytes() != before
        or current_image(gateway) != old_image
    ):
        raise InstallError("Gateway changed during staging; concurrent changes preserved.")
    backup = BACKUPS / stamp
    backup.mkdir(mode=0o700)
    for name, content in original.items():
        if content is not None:
            destination = backup / name
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            write(destination, content)
    write(backup / "khaneyar.conf", before)
    write(backup / "previous-image.txt", old_image.encode())
    capture(["docker", "image", "tag", old_image, rollback_image])
    override = backup / "rollback-compose.yml"
    write(override, ("services:\n  gateway:\n    image: " + rollback_image + "\n").encode())
    applied = dict(original)
    try:
        activation_files = files if household else {**files, "backend/ai_gateway/.env": replacement}
        for name, content in activation_files.items():
            if snapshot(names) != applied or NGINX.read_bytes() != before:
                raise InstallError("Files changed during activation; concurrent changes preserved.")
            destination = ROOT / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            write(destination, content, 0o600 if name.endswith("/.env") else 0o644)
            applied[name] = content
        activate(config, gateway, before, proposed, household=household)
    except (InstallError, OSError, ValueError, KeyboardInterrupt):
        if snapshot(names) != applied or NGINX.read_bytes() != before:
            print("Automatic rollback stopped to preserve administrator edits. Private backup:",
                  backup, flush=True)
            raise
        for name, content in original.items():
            if content is None:
                (ROOT / name).unlink(missing_ok=True)
            else:
                mode = 0o600 if name.endswith("/.env") or name == ".gateway-installer" else 0o644
                write(ROOT / name, content, mode)
        capture(["docker", "compose", "-f", str(gateway / "compose.yml"), "-f", str(override),
                 "up", "-d", "--no-build", "gateway"], gateway, timeout=90)
        if not wait_health():
            raise InstallError("Rollback is not healthy; inspect the private backup.") from None
        print("Previous gateway deployment restored; DeepSeek migration failed.", flush=True)
        raise


def wait_https_auth(*, origin: bool = False) -> bool:
    """Wait for reload, then verify gateway auth without credentials or inference."""
    label = "Origin HTTPS auth HTTP:" if origin else "Public HTTPS auth HTTP:"
    previous = None
    for attempt in range(12):
        try:
            status, payload = api(f"https://{HOST}/ai-gateway/v1/sms/analyze",
                                  body={"items": []}, origin=origin)
        except InstallError:
            print(label, "connection check failed", flush=True)
            return False
        if status != previous:
            print(label, status, flush=True)
            previous = status
        if status == 401 and payload.get("error") == "AI_GATEWAY_AUTH_FAILED":
            return True
        if status not in {404, 502, 503, 504}:
            print("The HTTPS response did not match gateway authentication.", flush=True)
            return False
        if attempt < 11:
            time.sleep(0.5)
    return False


def activate(config: dict[str, str], gateway: Path, before: bytes, proposed: str,
             *, household: bool = False) -> None:
    run(["docker", "compose", "up", "-d", "--no-build", "gateway"], gateway)
    if not wait_health():
        raise InstallError("The private gateway did not become healthy; nginx was not changed.")
    verify_activation(config, before, proposed, household=household)


def wait_health() -> bool:
    for _ in range(30):
        try:
            status, _ = api("http://127.0.0.1:5810/healthz")
            if status == 200:
                return True
        except InstallError:
            pass
        time.sleep(0.5)
    return False


def verify_activation(config: dict[str, str], before: bytes, proposed: str,
                      *, household: bool = False) -> None:
    status, payload = api("http://127.0.0.1:5810/v1/sms/analyze", body={"items": []})
    print("Local gateway auth HTTP:", status, flush=True)
    if status != 401 or payload.get("error") != "AI_GATEWAY_AUTH_FAILED":
        raise InstallError("Gateway authentication check failed; nginx was not changed.")
    if NGINX.read_bytes() != before:
        raise InstallError("nginx changed during installation; automatic activation was stopped.")
    # The Ubuntu console may still use Python 3.10, which has no datetime.UTC alias.
    backup = BACKUPS / datetime.now(timezone.utc).strftime(  # noqa: UP017
        "%Y%m%d-%H%M%S-%f"
    )
    backup.mkdir(parents=True, mode=0o700)
    write(backup / "khaneyar.conf", before)
    mode = NGINX.stat().st_mode & 0o777
    try:
        write(NGINX, proposed.encode("utf-8"), mode)
        run(["nginx", "-t"])
        run(["systemctl", "reload", "nginx"])
        origin_verified = wait_https_auth(origin=True)
        if not wait_https_auth():
            if origin_verified:
                raise InstallError(
                    "Origin HTTPS passed, but the public route failed; nginx restored.",
                )
            raise InstallError(
                "Origin and public HTTPS route checks failed; previous nginx restored.",
            )
        status, payload = api(
            f"https://{HOST}/ai-gateway/v1/sms/analyze", key=config["token"], body=SYNTHETIC_BODY,
        )
        print("Public HTTPS synthetic analysis HTTP:", status, flush=True)
        if status != 200 or not valid_analysis(payload):
            raise InstallError("The HTTPS analysis check did not succeed; previous nginx restored.")
        if household:
            verify_household_https(config)
    except (InstallError, OSError, KeyboardInterrupt):
        if NGINX.read_bytes() == proposed.encode("utf-8"):
            write(NGINX, before, mode)
            run(["nginx", "-t"])
            run(["systemctl", "reload", "nginx"])
        else:
            print("nginx changed during activation; concurrent edits were preserved.", flush=True)
        raise


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[2:] not in (
        [], ["--migrate-deepseek"], ["--upgrade-assistant"],
    ):
        raise InstallError("Use the gateway archive and one supported installation flag only.")
    if os.geteuid() != 0:
        raise InstallError("Run this installer as root in the server VNC console.")
    with installation_lock():
        install_locked()


def valid_analysis(payload: dict) -> bool:
    rows = payload.get("transactions")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        return False
    row = rows[0]
    try:
        amount = Decimal(str(row.get("amount")))
        source_index = Decimal(str(row.get("source_index")))
    except (InvalidOperation, ValueError):
        return False
    return (amount.is_finite() and amount == 10000
            and row.get("type") == "income" and row.get("unit") == "rial"
            and not isinstance(row.get("source_index"), bool)
            and source_index.is_finite() and source_index == 0
            and not isinstance(row.get("amount"), bool))


def verify_household_https(config: dict[str, str]) -> None:
    """Auth, capabilities and invalid input only: no additional billed inference."""
    paths = [f"https://{HOST}/ai-gateway/v1/assistant/{name}"
             for name in ("capabilities", "analyze", "plan", "report")]
    for path in paths:
        status, payload = api(path, **({"body": {}} if not path.endswith("/capabilities") else {}))
        if status != 401 or payload.get("error") != "AI_GATEWAY_AUTH_FAILED":
            raise InstallError("Household HTTPS route authentication failed.")
    status, payload = api(paths[0], key=config["token"])
    if (status != 200 or payload.get("status") != "ready"
            or type(payload.get("protocol_version")) is not int
            or payload["protocol_version"] != 2
            or payload.get("contextual") is not True or payload.get("max_inferences") != 2
            or payload.get("kinds") != ["transaction", "shopping_item", "task"]):
        raise InstallError("Household HTTPS capabilities verification failed.")
    for path in paths[1:]:
        status, payload = api(path, key=config["token"], body={})
        if status != 422 or payload.get("error") != "AI_GATEWAY_INVALID_REQUEST":
            raise InstallError("Household HTTPS bounded input verification failed.")


def install_locked() -> None:
    migration = sys.argv[2:] == ["--migrate-deepseek"]
    upgrade = sys.argv[2:] == ["--upgrade-assistant"]
    for name in ("docker", "nginx", "systemctl"):
        if not shutil.which(name):
            raise InstallError("The server requires Docker Compose, nginx and systemd.")
    run(["docker", "compose", "version"])
    run(["nginx", "-t"])
    files = archive_files(Path(sys.argv[1]).read_bytes())
    if not NGINX.is_file() or NGINX.is_symlink():
        raise InstallError("Expected the existing regular khaneyar.conf nginx file.")
    before = NGINX.read_bytes()
    proposed = add_nginx_route(before.decode("utf-8"))
    if ROOT.is_symlink():
        raise InstallError("The gateway installation directory must not be linked.")
    if ROOT.exists() and any(ROOT.iterdir()) and not (ROOT / ".gateway-installer").is_file():
        raise InstallError("The gateway directory already contains an unmanaged installation.")
    gateway = ROOT / "backend/ai_gateway"
    if upgrade:
        config, saved_env = upgrade_settings(gateway)
        print("Existing gateway token and DeepSeek key preserved for assistant upgrade.",
              flush=True)
        migrate(files, gateway, config, saved_env, before, proposed, household=True)
    elif migration:
        config, saved_env = saved_settings(gateway)
        current_image(gateway)
        print("Saved gateway token preserved. Enter only the NEW DeepSeek key, not the old key.",
              flush=True)
        key = hidden_input("DeepSeek API key (hidden): ").strip()
        config = private_settings(base64.b64encode(json.dumps({
            **config, "api_key": key,
        }).encode()).decode())
        migrate(files, gateway, config, saved_env, before, proposed)
    else:
        if ROOT.exists() and any(ROOT.iterdir()):
            raise InstallError("Existing gateway preserved; use --migrate-deepseek for migration.")
        print("Paste private server settings from the local VNC setup window.", flush=True)
        config = private_settings(hidden_input("Private settings (hidden): "))
        check_provider(config)
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        (ROOT / ".gateway-installer").touch(mode=0o600, exist_ok=True)
        for name, content in files.items():
            destination = ROOT / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            write(destination, content, 0o644)
        env = (
            f"DEEPSEEK_API_KEY={config['api_key']}\nAI_GATEWAY_TOKEN={config['token']}\n"
            f"AI_SMS_MODEL={config['model']}\nAI_SMS_TIMEOUT_SECONDS=25\n"
            "AI_GATEWAY_REQUESTS_PER_MINUTE=20\nAI_GATEWAY_CONCURRENCY=2\n"
        ).encode()
        write(gateway / ".env", env)
        run(["docker", "compose", "build"], gateway)
        capture(["docker", "compose", "run", "--rm", "--no-deps", "-T", "gateway", "python", "-m",
                 "ai_gateway.check", "--analyze"], gateway, timeout=90)
        activate(config, gateway, before, proposed)
    print("GATEWAY READY: https://" + HOST + "/ai-gateway", flush=True)
    print("Official DeepSeek key, model, private authentication and HTTPS analysis verified.")
    print("Return to the local test setup and choose the private server connection.")


if __name__ == "__main__":
    try:
        main()
    except InstallError as error:
        print("SETUP STOPPED: " + str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except KeyboardInterrupt:
        print("SETUP STOPPED: interrupted; check the last rollback status.", file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, ValueError, tarfile.TarError):
        print(
            "SETUP STOPPED: inspect the gateway files and the last installation step.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
