"""The inference gateway has no database, accepts only SMS and never echoes secrets."""

from __future__ import annotations

import json
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from ai_gateway import app as gateway
from app.services.sms_ai_protocol import SYSTEM_PROMPT
from app.services.sms_ai_provider import provider_error

TOKEN = secrets.token_urlsafe(32)
AUTH = {"Authorization": "Bearer " + TOKEN}
BODY = {"items": [{"source_index": 0, "text": "واریز مبلغ ۱۰۰۰۰ ریال", "account_aliases": []}]}


def make_app(**overrides):
    return gateway.create_app(gateway.GatewaySettings(
        deepseek_api_key="synthetic-provider-key",
        ai_gateway_token=TOKEN,
        **overrides,
    ))


@pytest.fixture
def captured(monkeypatch):
    calls = []

    def complete(messages, **options):
        calls.append((messages, options))
        return {"transactions": [{"amount": Decimal("10000.25"), "source_index": 0}]}

    monkeypatch.setattr(gateway, "request_deepseek", complete)
    return calls


def test_only_server_controls_model_prompt_and_provider_key(captured):
    with TestClient(make_app(ai_sms_model="deepseek-flash")) as client:
        result = client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY)
        assert result.status_code == 200
        assert result.json()["transactions"][0]["amount"] == "10000.25"
        assert result.headers["cache-control"] == "no-store"
        assert "synthetic-provider-key" not in result.text and TOKEN not in result.text
        messages, options = captured[0]
        assert messages[0]["content"] == SYSTEM_PROMPT
        assert options["model"] == "deepseek-flash"
        assert options["api_key"] == "synthetic-provider-key"
        assert len(messages) == 2
        assert client.post("/v1/chat/completions", headers=AUTH, json=BODY).status_code == 404
        assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_authentication_precedes_body_validation(captured, headers):
    with TestClient(make_app()) as client:
        result = client.post(gateway.PRIVATE_PATH, headers=headers, content=b"not json")
    assert result.status_code == 401
    assert result.json()["error"] == "AI_GATEWAY_AUTH_FAILED"
    assert captured == []


@pytest.mark.parametrize("extra", [
    {"model": "caller-paid-model"},
    {"url": "https://arbitrary.example/target"},
    {"messages": [{"role": "system", "content": "Caller system instruction"}]},
])
def test_arbitrary_proxy_options_and_prompts_are_rejected(captured, extra):
    with TestClient(make_app()) as client:
        response = client.post(gateway.PRIVATE_PATH, headers=AUTH, json={**BODY, **extra})
    assert response.status_code == 422
    assert response.json()["error"] == "AI_GATEWAY_INVALID_REQUEST"
    assert "caller-paid-model" not in response.text
    assert "Caller system instruction" not in response.text
    assert captured == []


def test_validation_does_not_echo_sms_or_account_ids(captured):
    private = "private-raw-sms-never-echo"
    with TestClient(make_app()) as client:
        response = client.post(gateway.PRIVATE_PATH, headers=AUTH, json={"items": [{
            "source_index": 0, "text": private, "account_id": "private-account-uuid",
        }]})
    assert response.status_code == 422
    assert private not in response.text and "private-account-uuid" not in response.text
    assert captured == []


def test_streamed_request_size_is_bounded_before_json_parsing(captured):
    chunks = (b"x" * 10000 for _ in range(28))
    with TestClient(make_app()) as client:
        response = client.post(gateway.PRIVATE_PATH, headers=AUTH, content=chunks)
    assert response.status_code == 413
    assert captured == []


def test_global_quota_prevents_provider_calls(captured):
    with TestClient(make_app(ai_gateway_requests_per_minute=1)) as client:
        assert client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY).status_code == 200
        response = client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY)
    assert response.status_code == 503
    assert response.json()["error"] == "AI_GATEWAY_BUSY"
    assert len(captured) == 1


def test_parallel_calls_are_bounded_and_slot_is_released(monkeypatch):
    entered, finish = threading.Event(), threading.Event()

    def complete(*_args, **_kwargs):
        entered.set()
        assert finish.wait(timeout=5)
        return {"transactions": []}

    monkeypatch.setattr(gateway, "request_deepseek", complete)
    with TestClient(make_app(ai_gateway_concurrency=1)) as client:
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(client.post, gateway.PRIVATE_PATH, headers=AUTH, json=BODY)
            try:
                assert entered.wait(timeout=3)
                second = client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY)
                assert second.status_code == 503
            finally:
                finish.set()
            assert first.result(timeout=5).status_code == 200
        assert client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY).status_code == 200


def test_provider_failure_retains_safe_error_and_releases_slot(monkeypatch):
    def reject(*_args, **_kwargs):
        raise provider_error("AI_ACCESS_DENIED")

    monkeypatch.setattr(gateway, "request_deepseek", reject)
    with TestClient(make_app(ai_gateway_concurrency=1)) as client:
        for _ in range(2):
            response = client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY)
            assert response.status_code == 502
            assert response.json()["error"] == "AI_ACCESS_DENIED"
            assert response.headers["cache-control"] == "no-store"


def test_health_reveals_no_credentials_or_provider_configuration(captured):
    with TestClient(make_app()) as client:
        response = client.get("/healthz")
    assert response.json() == {"status": "ok", "service": "sms-ai-gateway"}
    assert TOKEN not in response.text and "synthetic-provider-key" not in response.text
    assert captured == []


def test_source_indexes_and_batch_limit_are_enforced(captured):
    with TestClient(make_app()) as client:
        bad_index = json.loads(json.dumps(BODY))
        bad_index["items"][0]["source_index"] = 1
        assert client.post(gateway.PRIVATE_PATH, headers=AUTH, json=bad_index).status_code == 422
        assert client.post(
            gateway.PRIVATE_PATH, headers=AUTH, json={"items": BODY["items"] * 9},
        ).status_code == 422
    assert captured == []
