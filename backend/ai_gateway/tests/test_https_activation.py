"""HTTPS activation tolerates reload delays without bypassing authentication or verified TLS."""

from __future__ import annotations

import io
import ssl
import urllib.error
from unittest.mock import Mock

import pytest

from ai_gateway import install


def test_auth_wait_tolerates_short_reload_race(monkeypatch, capsys):
    results = iter([(404, {}), (502, {}), (401, {"error": "AI_GATEWAY_AUTH_FAILED"})])
    calls, sleeps = [], []

    def api(path, **options):
        calls.append((path, options))
        return next(results)

    monkeypatch.setattr(install, "api", api)
    monkeypatch.setattr(install.time, "sleep", sleeps.append)
    assert install.wait_https_auth(origin=True)
    assert sleeps == [0.5, 0.5]
    assert all(options == {"body": {"items": []}, "origin": True} for _path, options in calls)
    assert "Origin HTTPS auth HTTP: 401" in capsys.readouterr().out


@pytest.mark.parametrize("status,payload", [(200, {}), (403, {}), (401, {"error": "UNAUTHORIZED"})])
def test_wrong_route_or_auth_response_is_never_accepted(monkeypatch, status, payload):
    calls = []

    def api(_path, **options):
        calls.append(options)
        return status, payload

    monkeypatch.setattr(install, "api", api)
    assert not install.wait_https_auth()
    assert len(calls) == 1 and "key" not in calls[0]


def test_auth_wait_is_bounded_and_does_not_run_inference(monkeypatch):
    calls = []
    monkeypatch.setattr(install, "api", lambda path, **options: calls.append(options) or (404, {}))
    monkeypatch.setattr(install.time, "sleep", lambda _seconds: None)
    assert not install.wait_https_auth()
    assert len(calls) == 12
    assert all(call == {"body": {"items": []}, "origin": False} for call in calls)


def test_origin_keeps_verified_tls_and_hostname_while_pinning_only_address(monkeypatch):
    connection = install.OriginHTTPSConnection(install.HOST, timeout=5)
    assert connection._context.verify_mode == ssl.CERT_REQUIRED
    assert connection._context.check_hostname
    raw, wrapped, context = Mock(), Mock(), Mock()
    context.wrap_socket.return_value = wrapped
    connection._context = context
    create = Mock(return_value=raw)
    monkeypatch.setattr(install.socket, "create_connection", create)
    connection.connect()
    create.assert_called_once_with(("127.0.0.1", 443), timeout=5)
    context.wrap_socket.assert_called_once_with(raw, server_hostname=install.HOST)
    assert connection.sock is wrapped


def test_origin_refuses_unrelated_hosts_and_provider_endpoints():
    with pytest.raises(install.InstallError):
        install.OriginHTTPSConnection("another.example").connect()
    with pytest.raises(install.InstallError):
        install.api("https://api.deepseek.com/models", origin=True)


def test_http_error_body_is_parsed_without_echoing_private_data(monkeypatch, capsys):
    error = urllib.error.HTTPError(
        f"https://{install.HOST}/ai-gateway/v1/sms/analyze", 401, "Unauthorized", {},
        io.BytesIO(b'{"error":"AI_GATEWAY_AUTH_FAILED","message":"synthetic-private-value"}'),
    )

    def fail(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(install.urllib.request, "build_opener", lambda *_handlers: Mock(open=fail))
    status, payload = install.api(f"https://{install.HOST}/ai-gateway/v1/sms/analyze",
                                  body={"items": []})
    assert status == 401 and payload["error"] == "AI_GATEWAY_AUTH_FAILED"
    assert "synthetic-private-value" not in capsys.readouterr().out
