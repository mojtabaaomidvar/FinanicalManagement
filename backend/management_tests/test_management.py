"""Management authorization and host boundaries, with no application database or VPS access."""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
import threading
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.managed_runtime import ManagedRuntimeMiddleware
from app.management import identity
from app.management.contracts import Config, ManagementError, Operation
from app.management.driver import DemoDriver
from app.management.host import Host, digest, safe_extract
from app.management.main import create_app
from app.management.store import Store

PASSWORD = "correct-management-password"
ORIGIN = "http://127.0.0.1:5710"
PREFIX = "/management/api"


@pytest.fixture
def config(tmp_path):
    return Config(
        mode="demo",
        origin=ORIGIN,
        state_dir=tmp_path / "state",
        web_root=tmp_path / "web",
        deploy_dir=tmp_path / "deploy",
        backup_dir=tmp_path / "backups",
        release_dir=tmp_path / "releases",
        web_dir=tmp_path / "pwa",
    )


@pytest.fixture
def app(config):
    application = create_app(config)
    identity.create_account(application.state.store, "owner", PASSWORD, "owner", production=False)
    return application


@pytest.fixture
def client(app):
    with TestClient(app, base_url=ORIGIN) as connection:
        yield connection


def sign_in(client, username="owner", password=PASSWORD):
    result = client.post(
        PREFIX + "/login",
        json={"username": username, "password": password, "code": ""},
        headers={"Origin": ORIGIN},
    )
    assert result.status_code == 200, result.text
    client.headers.update({"Origin": ORIGIN, "X-Management-CSRF": result.json()["csrf"]})
    return result


def plan(client, operation):
    response = client.post(PREFIX + "/plans", json=operation)
    assert response.status_code == 200, response.text
    return response.json()


def execute(client, prepared, key=None, password=PASSWORD):
    return client.post(
        PREFIX + "/jobs",
        json={
            "plan_id": prepared["id"],
            "request_key": key or str(uuid4()),
            "password": password,
            "code": "",
        },
    )


def drain(app):
    app.state.executor.submit(lambda: None).result(timeout=10)


def test_application_roles_and_unknown_cookies_cannot_enter(client):
    for path in ("/state/overview", "/state/users", "/accounts", "/audit", "/jobs"):
        assert client.get(PREFIX + path).status_code == 401
    client.cookies.set(identity.COOKIE, "a" * 64, path=identity.COOKIE_PATH)
    assert not client.get(PREFIX + "/session").json()["authenticated"]


def test_management_page_and_assets_work_below_shared_support_host(config):
    config.web_root.mkdir()
    (config.web_root / "assets").mkdir()
    html = '<script type="module" src="./assets/panel.js"></script>'
    (config.web_root / "management.html").write_text(html)
    (config.web_root / "version.json").write_text('{"version":"0.1.0"}')
    (config.web_root / "assets/panel.js").write_text("export const ready = true;")
    with TestClient(create_app(config), base_url=ORIGIN) as connection:
        for path in ("/", "/management/"):
            response = connection.get(path)
            assert response.status_code == 200 and response.text == html
            assert response.headers["cache-control"] == "no-store"
        for path in ("/assets/panel.js", "/management/assets/panel.js"):
            assert connection.get(path).text == "export const ready = true;"
        assert connection.get("/management/version.json").json()["version"] == "0.1.0"
        assert connection.get(PREFIX + "/state/analytics").status_code == 401


def test_cookie_and_public_session_expose_no_credentials(client):
    response = sign_in(client)
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/management/api" in cookie
    payload = response.json()
    assert "password_hash" not in payload and "totp_secret" not in payload
    assert response.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_origin_csrf_and_content_type_are_enforced(client):
    assert (
        client.post(
            PREFIX + "/login",
            json={"username": "owner", "password": PASSWORD},
            headers={"Origin": "https://other.test"},
        ).status_code
        == 403
    )
    sign_in(client)
    assert (
        client.post(
            PREFIX + "/plans",
            json={"kind": "backup.create"},
            headers={"Origin": "https://other.test"},
        ).status_code
        == 403
    )
    client.headers.pop("X-Management-CSRF")
    assert client.post(PREFIX + "/plans", json={"kind": "backup.create"}).status_code == 403
    assert client.post(PREFIX + "/login", content="text").status_code == 415
    assert client.get(PREFIX + "/session", headers={"Host": "evil.test"}).status_code == 400


def test_failed_credentials_are_limited_without_echo(client):
    for _ in range(10):
        result = client.post(
            PREFIX + "/login",
            json={"username": "owner", "password": "sensitive-wrong-password"},
            headers={"Origin": ORIGIN},
        )
        assert result.status_code == 401
        assert "sensitive-wrong-password" not in result.text
    assert (
        client.post(
            PREFIX + "/login",
            json={"username": "owner", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        ).status_code
        == 429
    )


@pytest.mark.parametrize("role", ["viewer", "operator"])
def test_role_boundaries_are_server_side(app, client, role):
    identity.create_account(app.state.store, role, PASSWORD, role, production=False)
    sign_in(client, role)
    assert client.get(PREFIX + "/state/overview").status_code == 200
    assert client.get(PREFIX + "/accounts").status_code == 403
    assert client.get(PREFIX + "/audit").status_code == 403
    assert client.post(PREFIX + "/plans", json={"kind": "host.reboot"}).status_code == 403
    assert client.post(PREFIX + "/plans", json={"kind": "backup.create"}).status_code == (
        403 if role == "viewer" else 200
    )
    assert client.get(PREFIX + "/state/logs").status_code == (403 if role == "viewer" else 200)


def test_plan_is_tied_to_a_session_and_expires(app, client):
    sign_in(client)
    first = plan(client, {"kind": "backup.create"})
    sign_in(client)
    assert execute(client, first).status_code == 409
    second = plan(client, {"kind": "backup.create"})
    app.state.plans[second["id"]]["expires"] = time.time() - 1
    assert execute(client, second).status_code == 409


def test_confirmation_password_and_idempotency(app, client):
    sign_in(client)
    prepared = plan(client, {"kind": "backup.create"})
    assert execute(client, prepared, password="wrong-password").status_code == 401
    key = str(uuid4())
    accepted = execute(client, prepared, key)
    assert accepted.status_code == 200
    drain(app)
    repeated = execute(client, prepared, key)
    assert repeated.status_code == 200 and repeated.json()["id"] == accepted.json()["id"]
    assert len(app.state.driver.read("backups", {})["items"]) == 1


def test_only_one_mutation_runs_and_failures_are_recorded(app, client):
    sign_in(client)
    start, finish = threading.Event(), threading.Event()

    def blocked(_operation):
        start.set()
        assert finish.wait(10)
        raise RuntimeError("private-system-secret")

    first = plan(client, {"kind": "backup.create"})
    second = plan(client, {"kind": "nginx.reload"})
    with patch.object(app.state.driver, "apply", side_effect=blocked):
        assert execute(client, first).status_code == 200
        assert start.wait(5)
        try:
            assert execute(client, second).status_code == 409
        finally:
            finish.set()
        drain(app)
    jobs = client.get(PREFIX + "/jobs")
    assert jobs.json()["items"][0]["status"] == "failed"
    assert "private-system-secret" not in jobs.text


def test_secrets_are_redacted_from_plan_jobs_audit_and_database(app, client):
    sign_in(client)
    secret = "private-sms-key-for-management-test"
    prepared = plan(client, {"kind": "settings.update", "values": {"SMS_API_KEY": secret}})
    assert secret not in json.dumps(prepared)
    assert execute(client, prepared).status_code == 200
    drain(app)
    for path in ("/state/settings", "/jobs", "/audit", "/accounts"):
        assert secret not in client.get(PREFIX + path).text
    with app.state.store.connect() as db:
        serialized = "\n".join(db.iterdump())
    assert secret not in serialized and PASSWORD not in serialized


def test_self_lockout_is_rejected_and_account_changes_revoke_sessions(app, client):
    sign_in(client)
    accounts = client.get(PREFIX + "/accounts").json()["items"]
    own = accounts[0]
    assert (
        client.patch(
            PREFIX + "/accounts/" + own["id"],
            json={"role": "viewer", "enabled": True, "password": PASSWORD},
        ).status_code
        == 409
    )
    other = identity.create_account(
        app.state.store, "other", PASSWORD, "operator", production=False
    )
    with TestClient(app, base_url=ORIGIN) as other_client:
        sign_in(other_client, "other")
        assert (
            client.patch(
                PREFIX + "/accounts/" + other["id"],
                json={"role": "viewer", "enabled": False, "password": PASSWORD},
            ).status_code
            == 200
        )
        assert other_client.get(PREFIX + "/state/overview").status_code == 401


def test_last_owner_is_protected_even_from_direct_identity_call(config):
    store = Store(config.state_dir)
    owner = identity.create_account(store, "owner", PASSWORD, "owner", production=False)
    with pytest.raises(ManagementError, match="LAST_OWNER"):
        identity.update_account(
            store,
            {"role": "owner", "id": str(uuid4()), "username": "recovery"},
            owner["id"],
            "viewer",
            True,
            "",
        )


def test_account_secret_is_only_returned_during_creation(config):
    store = Store(config.state_dir)
    created = identity.create_account(store, "production", PASSWORD, "owner", production=True)
    assert len(created["totp_secret"]) == 32
    with store.connect() as db:
        account = db.execute("SELECT * FROM accounts WHERE id=?", (created["id"],)).fetchone()
        identity.verify_credential(
            db, account, PASSWORD, identity.totp(created["totp_secret"]), True
        )
    with store.connect() as db:
        account = db.execute("SELECT * FROM accounts WHERE id=?", (created["id"],)).fetchone()
        with pytest.raises(ManagementError):
            identity.verify_credential(
                db, account, PASSWORD, identity.totp(created["totp_secret"]), True
            )


def test_production_mfa_and_secure_cookie(config):
    production = config.model_copy(
        update={"mode": "production", "origin": "https://admin.example.test"}
    )
    application = create_app(production, driver=DemoDriver(config))
    account = identity.create_account(
        application.state.store, "owner", PASSWORD, "owner", production=True
    )
    with TestClient(application, base_url=production.origin) as connection:
        body = {"username": "owner", "password": PASSWORD, "code": "000000"}
        with patch.object(identity, "totp", return_value="123456"):
            assert (
                connection.post(
                    PREFIX + "/login", json=body, headers={"Origin": production.origin}
                ).status_code
                == 401
            )
            body["code"] = "123456"
            response = connection.post(
                PREFIX + "/login", json=body, headers={"Origin": production.origin}
            )
            assert response.status_code == 200
            assert "Secure" in response.headers["set-cookie"]
        assert account["totp_secret"] not in response.text


def test_interrupted_jobs_are_not_replayed(config):
    store = Store(config.state_dir)
    with store.connect() as db:
        db.execute(
            "INSERT INTO jobs VALUES (?,?,?,?,?,'running',NULL,?,NULL)",
            (
                str(uuid4()),
                "owner",
                "owner",
                str(uuid4()),
                json.dumps({"kind": "backup.restore"}),
                time.time(),
            ),
        )
    store.recover()
    assert store.jobs()[0]["status"] == "interrupted"


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "shell", "target": "whoami"},
        {"kind": "service.restart", "target": "api; rm -rf /"},
        {"kind": "service.restart", "target": "nginx"},
        {"kind": "backup.restore", "target": "../../etc"},
        {"kind": "release.fetch", "target": "https://evil.test"},
        {"kind": "user.suspend", "target": "' OR true --"},
        {"kind": "settings.update", "values": {"DOCUMENT_ENCRYPTION_KEY": "changed"}},
        {"kind": "settings.update", "values": {"SMS_API_KEY": "a\nDATABASE_URL=evil"}},
        {"kind": "settings.update", "values": {"SMS_API_KEY": "$(whoami)"}},
        {"kind": "settings.update", "values": {"maintenance": "true"}},
        {"kind": "settings.update", "values": {"AI_SMS_GATEWAY_URL": "http://evil.test"}},
        {"kind": "backup.create", "extra": "ignored"},
    ],
)
def test_finite_worker_contract_rejects_arbitrary_commands_and_settings(payload):
    with pytest.raises(ValidationError):
        Operation.model_validate(payload)


@pytest.mark.parametrize(
    "overrides",
    [
        {"host": "0.0.0.0"},
        {"origin": ORIGIN + "/"},
        {"mode": "production", "origin": ORIGIN},
        {"mode": "demo", "origin": "http://remote.test"},
    ],
)
def test_management_cannot_accidentally_bind_public_demo(config, overrides):
    with pytest.raises(ValidationError):
        Config.model_validate({**config.model_dump(), **overrides})


@pytest.mark.parametrize(
    "name,kind",
    [
        ("../escaped", "file"),
        ("/absolute", "file"),
        ("safe", "symlink"),
        ("safe", "fifo"),
        ("a\\b", "file"),
    ],
)
def test_archive_rejects_traversal_and_links_before_extraction(tmp_path, name, kind):
    path = tmp_path / "archive.tar"
    with tarfile.open(path, "w") as archive:
        item = tarfile.TarInfo(name)
        if kind == "symlink":
            item.type = tarfile.SYMTYPE
            item.linkname = "/etc/passwd"
        elif kind == "fifo":
            item.type = tarfile.FIFOTYPE
        archive.addfile(item)
    output = tmp_path / "output"
    output.mkdir()
    with pytest.raises(ManagementError):
        safe_extract(path, output)
    assert not list(output.iterdir())


def test_valid_archive_extracts_and_duplicate_member_is_rejected(tmp_path):
    path = tmp_path / "archive.tar"
    with tarfile.open(path, "w") as archive:
        member = tarfile.TarInfo("pwa/index.html")
        member.size = 5
        archive.addfile(member, io.BytesIO(b"hello"))
    safe_extract(path, tmp_path / "valid")
    assert (tmp_path / "valid/pwa/index.html").read_text() == "hello"
    with tarfile.open(path, "a") as archive:
        archive.addfile(tarfile.TarInfo("pwa/index.html"))
    with pytest.raises(ManagementError):
        safe_extract(path, tmp_path / "invalid")


def test_host_log_redaction(config):
    config.deploy_dir.mkdir()
    (config.deploy_dir / ".env").write_text(
        "SMS_API_KEY=private-secret\nDATABASE_URL=postgresql://u:p@db/db\n"
    )
    output = Host(config).redact(
        "private-secret 09123456789 Bearer xyz postgresql://u:p@db/db token=abc " + "a" * 64
    )
    for value in (
        "private-secret",
        "09123456789",
        "xyz",
        "postgresql://u:p@db/db",
        "token=abc",
        "a" * 64,
    ):
        assert value not in output


@pytest.fixture
def backed_up_host(config):
    config.deploy_dir.mkdir()
    config.web_dir.mkdir()
    (config.web_dir / "index.html").write_text("web")
    (config.deploy_dir / "uploads").mkdir()
    (config.deploy_dir / "uploads/photo").write_bytes(b"private-upload")
    (config.deploy_dir / ".env").write_text(
        "DOCUMENT_ENCRYPTION_KEY=preserved-key\nOTHER=preserved\n"
    )
    (config.deploy_dir / "docker-compose.yml").write_text("services: {}")
    host = Host(config)
    calls = []
    host.services = lambda: [{"id": "api", "state": "running"}]
    host.image = lambda: "sha256:" + "a" * 64
    host.application_role = lambda: {
        "name": "khaneyar_api",
        "password": "SCRAM-SHA-256$test-role-hash",
        "superuser": False,
        "bypass": False,
    }
    host.sql = lambda *_args, **_kwargs: ""

    def compose(*args, **kwargs):
        calls.append(args)
        if args[:3] == ("exec", "-T", "db"):
            kwargs["output"].write(b"PGDMP-consistent-test-database")
        return b""

    def run(args, **_kwargs):
        if args[1:3] == ["image", "save"]:
            Path(args[4]).write_bytes(b"image-snapshot")
        return b""

    host.compose = compose
    host.run = run
    saved = host.backup()
    return host, saved, calls


def test_consistent_backup_preserves_key_files_and_resume(backed_up_host, tmp_path):
    host, saved, calls = backed_up_host
    path, manifest = host.verify_backup(saved["backup_id"])
    assert manifest["image"] == "sha256:" + "a" * 64
    assert "SCRAM-SHA-256$test-role-hash" not in json.dumps(manifest)
    assert json.loads((path / "application-role.json").read_text())["bypass"] is False
    assert calls[0] == ("stop", "api") and calls[-1] == ("start", "api")
    safe_extract(path / "files.tar.gz", tmp_path / "inspected")
    assert "preserved-key" in (tmp_path / "inspected/config/.env").read_text()
    assert (tmp_path / "inspected/uploads/photo").read_bytes() == b"private-upload"


def test_backup_rejects_a_privileged_application_role(config):
    config.deploy_dir.mkdir()
    (config.deploy_dir / ".env").write_text("DATABASE_URL=postgresql://app:private@db/app\n")
    host = Host(config)
    host.sql = lambda *_args: json.dumps(
        {"name": "app", "password": "md5test", "superuser": True, "bypass": False}
    )
    with pytest.raises(ManagementError, match="ROLE_UNSAFE"):
        host.application_role()


@pytest.mark.parametrize("corrupt", [False, True])
def test_official_tgz_release_checksum_and_structure(config, corrupt):
    from app.management.host import REPOSITORY

    data = io.BytesIO()
    files = {
        "release-tag.txt": b"v0.6.0\n",
        "pwa/index.html": b"web",
        "source/backend/Dockerfile": b"FROM example\n",
        "source/backend/deploy/install-release.sh": b"#!/bin/bash\nexit 0\n",
    }
    with tarfile.open(fileobj=data, mode="w:gz") as archive:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    package = data.getvalue()
    checksum = "0" * 64 if corrupt else hashlib.sha256(package).hexdigest()
    base = f"https://github.com/{REPOSITORY}/releases/download/v0.6.0/"
    metadata = {
        "draft": False,
        "prerelease": False,
        "assets": [
            {
                "name": "khaneyar-v0.6.0.tgz",
                "size": len(package),
                "browser_download_url": base + "khaneyar-v0.6.0.tgz",
            },
            {"name": "SHA256SUMS", "size": 100, "browser_download_url": base + "SHA256SUMS"},
        ],
    }

    def opened(request, **_kwargs):
        url = request.full_url
        if url.startswith("https://api.github.com/"):
            return io.BytesIO(json.dumps(metadata).encode())
        if url == base + "SHA256SUMS":
            return io.BytesIO((checksum + "  khaneyar-v0.6.0.tgz\n").encode())
        assert url == base + "khaneyar-v0.6.0.tgz"
        return io.BytesIO(package)

    host = Host(config)
    with patch("app.management.host.urlopen", side_effect=opened):
        if corrupt:
            with pytest.raises(ManagementError, match="RELEASE_HASH"):
                host.fetch_release("v0.6.0")
            assert not (config.release_dir / "v0.6.0").exists()
        else:
            result = host.fetch_release("v0.6.0")
            assert result["sha256"] == checksum
            host.verify_release(host.release_path("v0.6.0"))


def test_corrupted_backup_stops_restore_before_any_mutation(backed_up_host):
    host, saved, calls = backed_up_host
    prepared = host.prepare(Operation(kind="backup.restore", target=saved["backup_id"]))
    (host.config.backup_dir / saved["backup_id"] / "database.dump").write_bytes(b"corrupt")
    calls.clear()
    with pytest.raises(ManagementError, match="BACKUP_HASH"):
        host.restore(prepared)
    assert not calls


def test_failed_restore_leaves_api_stopped_and_safety_backup(backed_up_host):
    host, saved, calls = backed_up_host
    prepared = host.prepare(Operation(kind="backup.restore", target=saved["backup_id"]))
    with patch(
        "app.management.host.subprocess.run", return_value=subprocess.CompletedProcess([], 1)
    ):
        with pytest.raises(ManagementError, match="RESTORE_FAILED"):
            host.restore(prepared)
    assert calls[-1] == ("stop", "api")
    assert len(list(host.config.backup_dir.glob("*/manifest.json"))) == 2


@pytest.fixture
def runtime_client(tmp_path, monkeypatch):
    path = tmp_path / "runtime.json"
    path.write_text("{}")
    monkeypatch.setenv("KHANEYAR_RUNTIME_FILE", str(path))
    application = FastAPI()
    application.add_middleware(ManagedRuntimeMiddleware)

    @application.api_route("/{path:path}", methods=["GET", "POST", "OPTIONS"])
    def endpoint(path: str):
        return {"ok": True}

    with TestClient(application) as connection:
        yield connection, path


def test_maintenance_does_not_block_support_or_session_teardown(runtime_client):
    connection, path = runtime_client
    path.write_text(json.dumps({"maintenance": True}))
    assert connection.get("/api/v1/accounts").status_code == 503
    for url in ("/api/v1/support/session", "/api/v1/healthz", "/api/v1/auth/config"):
        assert connection.get(url).status_code == 200
    assert connection.post("/api/v1/auth/logout").status_code == 200


def test_closed_registration_and_assistant_are_enforced(runtime_client):
    connection, path = runtime_client
    path.write_text(json.dumps({"registration_enabled": False, "assistant_enabled": False}))
    for url in (
        "/api/v1/auth/register",
        "/api/v1/auth/join",
        "/api/v1/auth/accept-invite",
        "/api/v1/assistant/chat",
        "/api/v1/sms/assistant/analyze",
    ):
        assert connection.post(url).status_code == 503
    assert connection.post("/api/v1/auth/login").status_code == 200
    assert connection.get("/api/v1/accounts").status_code == 200
    assert connection.options("/api/v1/auth/register").status_code == 200


def test_missing_or_invalid_managed_runtime_fails_closed(runtime_client):
    connection, path = runtime_client
    path.write_text('{"maintenance":"false"}')
    assert connection.get("/api/v1/accounts").status_code == 503
    path.unlink()
    assert connection.get("/api/v1/accounts").status_code == 503


def test_without_runtime_integration_existing_app_behavior_is_preserved(
    runtime_client, monkeypatch
):
    connection, path = runtime_client
    monkeypatch.delenv("KHANEYAR_RUNTIME_FILE")
    path.unlink()
    assert connection.get("/api/v1/accounts").status_code == 200
