"""Active-service migration stages first, preserves private settings, and pins rollback images."""

from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tarfile
import warnings

import pytest

from ai_gateway import install

NGINX = "server { listen 443 ssl; server_name api.khaanehyar.ir; location / {} }"
ENV = (
    b"# preserve this manual setting\nOPENROUTER_API_KEY=sk-or-v1-synthetic-key\n"
    b"AI_GATEWAY_TOKEN=" + b"t" * 43 + b"\nAI_SMS_MODEL=old/model:free\n"
    b"AI_SMS_TIMEOUT_SECONDS=20\nAI_GATEWAY_REQUESTS_PER_MINUTE=17\nEXTRA_VALUE=keep\n"
)
KEY = "sk-synthetic-deepseek-key"
IMAGE = "sha256:" + "a" * 64
CURRENT_IMAGE = install.current_image
GOOD = {"transactions": [{"source_index": "0", "type": "income",
                          "amount": "10000", "unit": "rial"}]}


@pytest.fixture
def migration(tmp_path, monkeypatch):
    root = tmp_path / "gateway"
    gateway = root / "backend/ai_gateway"
    gateway.mkdir(parents=True)
    (root / ".gateway-installer").touch()
    (gateway / ".env").write_bytes(ENV)
    (gateway / "compose.yml").write_text("services: {}")
    (gateway / "app.py").write_text("# old live code")
    nginx = tmp_path / "nginx.conf"
    nginx.write_text(NGINX)
    bundle = tmp_path / "gateway.tgz"
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as target:
        for name in install.FILES:
            info = tarfile.TarInfo(name)
            content = b"# synthetic DeepSeek code"
            if name == "backend/ai_gateway/compose.yml":
                content = (b"services:\n  gateway:\n"
                           b"    image: ${AI_GATEWAY_IMAGE:-khaneyar-ai-gateway-gateway}\n")
            info.size = len(content)
            target.addfile(info, io.BytesIO(content))
    bundle.write_bytes(stream.getvalue())
    monkeypatch.setattr(install, "ROOT", root)
    monkeypatch.setattr(install, "NGINX", nginx)
    monkeypatch.setattr(install, "BACKUPS", tmp_path / "backups")
    monkeypatch.setattr(install.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda _name: "/usr/bin/synthetic-tool")
    monkeypatch.setattr(install.sys, "argv", ["install.py", str(bundle), "--migrate-deepseek"])
    monkeypatch.setattr(install.getpass, "getpass", lambda _message: KEY)
    monkeypatch.setattr(install, "installation_lock", contextlib.nullcontext)
    monkeypatch.setattr(install, "current_image", lambda _gateway: IMAGE)
    commands = []
    monkeypatch.setattr(install, "run", lambda command, cwd=None: commands.append(command))
    state = {"failure": "", "public_status": 200, "manual": "", "env": ENV, "household": False}

    def capture(command, cwd=None, **_options):
        commands.append(command)
        if command[1] in {"build", "run"}:
            # The old service, code, and environment stay untouched through both preflight stages.
            assert (gateway / ".env").read_bytes() == state["env"]
            assert (gateway / "app.py").read_text() == "# old live code"
            assert not any("up" in item for item in commands)
            if state["failure"] == "build" and command[1] == "build":
                raise install.InstallError("Synthetic candidate failure")
        if command[1] == "run":
            if "--network" in command:
                assert command[command.index("--network") + 1] == "none"
                assert "--env-file" not in command and "--analyze" not in command
                assert "--read-only" in command and "--publish" not in command
                if state["failure"] == "imports":
                    raise install.InstallError("Synthetic missing image module")
                return "GATEWAY IMPORT READY\n"
            if state["failure"] == "run":
                raise install.InstallError("Synthetic candidate failure")
            private = command[command.index("--env-file") + 1]
            content = install.Path(private).read_bytes()
            assert KEY.encode() in content
            if not state["household"]:
                assert b"OPENROUTER_API_KEY" not in content
            else:
                assert content == state["env"]
            assert "-p" not in command and "--publish" not in command
            if state["manual"] == "staging":
                (gateway / "app.py").write_text("# administrator edit")
            return KEY + "\nDEEPSEEK READY: configured key and model verified.\n"
        return ""

    monkeypatch.setattr(install, "capture", capture)

    def api(url, **options):
        if url.endswith("/healthz"):
            return 200, {"status": "ok"}
        if options.get("key"):
            if state["manual"] == "activation":
                nginx.write_text("# administrator edit\n" + NGINX)
            return state["public_status"], GOOD
        return 401, {"error": "AI_GATEWAY_AUTH_FAILED"}

    monkeypatch.setattr(install, "api", api)
    return gateway, nginx, state, commands, tmp_path / "backups"


def test_success_backs_up_old_key_and_switches_only_after_preflight(migration, capsys):
    gateway, nginx, _state, commands, backups = migration
    install.main()
    current = (gateway / ".env").read_bytes()
    assert b"OPENROUTER_API_KEY" not in current and KEY.encode() in current
    assert b"AI_SMS_MODEL=deepseek-flash" in current
    assert b"AI_SMS_TIMEOUT_SECONDS=20" in current and b"EXTRA_VALUE=keep" in current
    assert b"AI_GATEWAY_TOKEN=" + b"t" * 43 in current
    assert list(backups.glob("*/backend/ai_gateway/.env"))[0].read_bytes() == ENV
    assert list(backups.glob("*/previous-image.txt"))[0].read_text() == IMAGE
    assert list(backups.glob("*/backend/ai_gateway/app.py"))[0].read_text() == "# old live code"
    assert install.INCLUDE in nginx.read_text()
    output = capsys.readouterr().out
    assert "GATEWAY READY" in output and KEY not in output
    assert "sk-or-v1-synthetic-key" not in output
    assert all(KEY not in str(command) and "t" * 43 not in str(command) for command in commands)
    runs = [c for c in commands if c[1] == "run"]
    assert len(runs) == 2 and "--network" in runs[0] and "--analyze" in runs[1]
    assert not list(backups.glob("deepseek-stage-*"))


@pytest.mark.parametrize("failure", ["build", "imports", "run"])
def test_preflight_failure_never_replaces_live_files_or_service(migration, failure):
    gateway, nginx, state, commands, _backups = migration
    state["failure"] = failure
    with pytest.raises(install.InstallError):
        install.main()
    assert (gateway / ".env").read_bytes() == ENV
    assert (gateway / "app.py").read_text() == "# old live code"
    assert nginx.read_text() == NGINX
    assert not any("up" in command for command in commands)


def test_missing_image_module_never_starts_a_billed_probe(migration, capsys):
    gateway, nginx, state, commands, _backups = migration
    state["failure"] = "imports"
    with pytest.raises(install.InstallError, match="no inference attempted"):
        install.main()
    assert not any("--analyze" in command for command in commands)
    assert not any("up" in command for command in commands)
    assert (gateway / ".env").read_bytes() == ENV
    assert (gateway / "app.py").read_text() == "# old live code"
    assert nginx.read_text() == NGINX
    output = capsys.readouterr().out
    assert "offline" in output and "billable" not in output and KEY not in output


def test_failed_https_restores_old_code_key_and_immutable_image(migration, capsys):
    gateway, nginx, state, commands, backups = migration
    state["public_status"] = 502
    with pytest.raises(install.InstallError):
        install.main()
    assert (gateway / ".env").read_bytes() == ENV and nginx.read_text() == NGINX
    assert (gateway / "app.py").read_text() == "# old live code"
    rollback = next(command for command in commands if "rollback-compose.yml" in " ".join(command))
    assert "--no-build" in rollback and "gateway" in rollback
    override = list(backups.glob("*/rollback-compose.yml"))[0].read_text()
    assert "image: khaneyar-ai-gateway:rollback-" in override
    assert "GATEWAY READY" not in capsys.readouterr().out


@pytest.mark.parametrize("phase", ["staging", "activation"])
def test_concurrent_administrator_edits_are_never_overwritten(migration, phase):
    gateway, nginx, state, commands, _backups = migration
    state.update(manual=phase, public_status=502)
    with pytest.raises(install.InstallError):
        install.main()
    if phase == "staging":
        assert (gateway / "app.py").read_text() == "# administrator edit"
        assert (gateway / ".env").read_bytes() == ENV
        assert not any("up" in command for command in commands)
    else:
        assert nginx.read_text().startswith("# administrator edit")
        assert not any("rollback-compose.yml" in " ".join(c) for c in commands)


def test_duplicate_settings_and_unmanaged_gateway_are_rejected(migration):
    gateway, *_rest = migration
    (gateway / ".env").write_bytes(ENV + b"AI_SMS_MODEL=duplicate\n")
    with pytest.raises(install.InstallError):
        install.saved_settings(gateway)
    (gateway / ".env").write_bytes(ENV)
    (install.ROOT / ".gateway-installer").unlink()
    with pytest.raises(install.InstallError):
        install.saved_settings(gateway)


def test_legacy_key_cannot_be_reinterpreted_as_deepseek(migration, monkeypatch):
    gateway, _nginx, _state, commands, _backups = migration
    monkeypatch.setattr(install.getpass, "getpass", lambda _prompt: "sk-or-v1-synthetic-key")
    with pytest.raises(install.InstallError):
        install.main()
    assert (gateway / ".env").read_bytes() == ENV
    assert not any("build" in command for command in commands)


def test_hidden_input_fails_closed_without_a_terminal(monkeypatch):
    def warn(_prompt):
        warnings.warn("Cannot hide input", install.getpass.GetPassWarning, stacklevel=2)
        pytest.fail("Must not fall back to an echoed input")

    monkeypatch.setattr(install.getpass, "getpass", warn)
    with pytest.raises(install.InstallError, match="hidden terminal"):
        install.hidden_input("Private: ")


def test_actual_container_identity_is_checked_without_printing_inspect_data(migration, monkeypatch):
    gateway, *_rest = migration
    details = [{"Image": IMAGE, "Config": {"Labels": {
        "com.docker.compose.project": "khaneyar-ai-gateway",
        "com.docker.compose.service": "gateway",
    }}, "State": {"Running": True}, "HostConfig": {"PortBindings": {
        "8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5810"}],
    }}}]
    monkeypatch.setattr(install, "capture", lambda command, *_a, **_kw:
                        "b" * 64 if "ps" in command else json.dumps(details))
    assert CURRENT_IMAGE(gateway) == IMAGE
    details[0]["HostConfig"]["PortBindings"]["8000/tcp"][0]["HostIp"] = "0.0.0.0"  # noqa: S104
    with pytest.raises(install.InstallError):
        CURRENT_IMAGE(gateway)


def test_failed_probe_prints_only_safe_diagnostics(monkeypatch, capsys):
    private_output = (KEY + "\nDeepSeek authenticated model list HTTP: 200\n"
                      '{"error":"AI_PROVIDER_CREDIT_REQUIRED","detail":"' + KEY + '"}\n')
    monkeypatch.setattr(install.subprocess, "run", lambda command, **_kw:
                        subprocess.CompletedProcess(command, 1, stdout=private_output, stderr=KEY))
    with pytest.raises(install.InstallError):
        install.capture(["docker", "run", "candidate", "-m", "ai_gateway.check", "--analyze"])
    output = capsys.readouterr().out
    assert "AI_PROVIDER_CREDIT_REQUIRED" in output and KEY not in output


def test_concurrent_installer_lock_is_rejected(tmp_path, monkeypatch):
    class FakeFcntl:
        LOCK_EX = 1
        LOCK_NB = 2

        @staticmethod
        def flock(_fd, _mode):
            raise OSError("locked")

    monkeypatch.setitem(sys.modules, "fcntl", FakeFcntl)
    monkeypatch.setattr(install, "ROOT", tmp_path / "gateway")
    # Windows has no O_NOFOLLOW; Linux's real implementation remains unchanged.
    monkeypatch.setattr(
        install.os, "O_NOFOLLOW", getattr(install.os, "O_NOFOLLOW", 0), raising=False,
    )
    with pytest.raises(install.InstallError, match="Another gateway installer"):
        with install.installation_lock():
            pytest.fail("Lock must fail before modifying any service")


def test_shell_compose_overrides_cannot_target_another_application(tmp_path, monkeypatch):
    monkeypatch.setenv("COMPOSE_FILE", "production-compose.yml")
    monkeypatch.setenv("COMPOSE_PROJECT_NAME", "production")
    monkeypatch.setenv("AI_GATEWAY_IMAGE", "unverified-image")
    calls = []

    def process(command, **options):
        calls.append((command, options))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(install.subprocess, "run", process)
    install.capture(["docker", "compose", "up", "-d", "--no-build", "gateway"], tmp_path)
    command, options = calls[0]
    assert command[command.index("--project-name") + 1] == "khaneyar-ai-gateway"
    assert command[command.index("-f") + 1] == str(tmp_path / "compose.yml")
    assert command[command.index("--env-file") + 1] == str(tmp_path / ".env")
    assert not any(name.startswith("COMPOSE_") for name in options["env"])
    assert "AI_GATEWAY_IMAGE" not in options["env"]


@pytest.mark.parametrize("crlf", [False, True])
def test_household_upgrade_preserves_credentials_and_checks_routes_without_key_prompt(
    migration, monkeypatch, capsys, crlf,
):
    gateway, _nginx, state, _commands, backups = migration
    deployed = ENV.replace(b"AI_SMS_MODEL=old/model:free", b"AI_SMS_MODEL=deepseek-flash")
    deployed += b"DEEPSEEK_API_KEY=" + KEY.encode() + b"\n"
    deployed += b"AI_GATEWAY_IMAGE=khaneyar-ai-gateway:previous-pinned-image\n"
    if crlf:
        deployed = deployed.replace(b"\n", b"\r\n")
    (gateway / ".env").write_bytes(deployed)
    state.update(env=deployed, household=True)
    monkeypatch.setattr(install.sys, "argv", [*install.sys.argv[:2], "--upgrade-assistant"])
    monkeypatch.setattr(install, "hidden_input",
                        lambda _prompt: pytest.fail("key must stay private"))
    previous_api = install.api
    calls = []

    def api(url, **options):
        if "/assistant/" not in url:
            return previous_api(url, **options)
        calls.append((url, options))
        if not options.get("key"):
            return 401, {"error": "AI_GATEWAY_AUTH_FAILED"}
        if url.endswith("/capabilities"):
            return 200, {"status": "ready", "protocol_version": 2, "contextual": True,
                         "max_inferences": 2,
                         "kinds": ["transaction", "shopping_item", "task"]}
        assert options["body"] == {}
        return 422, {"error": "AI_GATEWAY_INVALID_REQUEST"}

    monkeypatch.setattr(install, "api", api)
    install.main()
    actual = (gateway / ".env").read_bytes()
    assert actual == deployed
    compose = (gateway / "compose.yml").read_text()
    assert "image: khaneyar-ai-gateway:deepseek-" in compose
    assert "${AI_GATEWAY_IMAGE" not in compose
    assert list(backups.glob("*/backend/ai_gateway/.env"))[0].read_bytes() == deployed
    assert len(calls) == 8
    assert KEY not in capsys.readouterr().out


def test_missing_household_https_route_rolls_back_code_settings_and_pinned_image(
    migration, monkeypatch,
):
    gateway, nginx, state, commands, _backups = migration
    deployed = ENV.replace(b"AI_SMS_MODEL=old/model:free", b"AI_SMS_MODEL=deepseek-flash")
    deployed += b"DEEPSEEK_API_KEY=" + KEY.encode() + b"\n"
    (gateway / ".env").write_bytes(deployed)
    state.update(env=deployed, household=True)
    monkeypatch.setattr(install.sys, "argv", [*install.sys.argv[:2], "--upgrade-assistant"])
    previous_api = install.api
    monkeypatch.setattr(install, "api", lambda url, **options:
                        (404, {}) if "/assistant/" in url else previous_api(url, **options))
    with pytest.raises(install.InstallError, match="Household HTTPS"):
        install.main()
    assert (gateway / ".env").read_bytes() == deployed
    assert (gateway / "app.py").read_text() == "# old live code"
    assert nginx.read_text() == NGINX
    assert any("rollback-compose.yml" in " ".join(command) for command in commands)


def test_upgrade_refuses_non_deepseek_settings_before_staging(migration, monkeypatch):
    gateway, _nginx, _state, commands, _backups = migration
    monkeypatch.setattr(install.sys, "argv", [*install.sys.argv[:2], "--upgrade-assistant"])
    with pytest.raises(install.InstallError, match="approved DeepSeek"):
        install.main()
    assert (gateway / ".env").read_bytes() == ENV
    assert not any("build" in command for command in commands)


@pytest.mark.parametrize("failure", ["build", "imports", "run"])
def test_household_candidate_failure_keeps_live_credentials_and_code(
    migration, monkeypatch, failure,
):
    gateway, nginx, state, commands, _backups = migration
    deployed = ENV.replace(b"AI_SMS_MODEL=old/model:free", b"AI_SMS_MODEL=deepseek-flash")
    deployed += b"DEEPSEEK_API_KEY=" + KEY.encode() + b"\n"
    (gateway / ".env").write_bytes(deployed)
    state.update(env=deployed, household=True, failure=failure)
    monkeypatch.setattr(install.sys, "argv", [*install.sys.argv[:2], "--upgrade-assistant"])
    message = "no inference attempted" if failure == "imports" else "Synthetic candidate"
    with pytest.raises(install.InstallError, match=message):
        install.main()
    assert (gateway / ".env").read_bytes() == deployed
    assert (gateway / "app.py").read_text() == "# old live code"
    assert (gateway / "compose.yml").read_text() == "services: {}"
    assert nginx.read_text() == NGINX
    assert not any("up" in command for command in commands)
    if failure == "imports":
        assert not any("--analyze" in command for command in commands)
