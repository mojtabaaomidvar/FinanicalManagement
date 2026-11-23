"""Independent household protocol shares authentication and capacity with unchanged SMS."""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from ai_gateway import app as gateway
from ai_gateway.tests.test_gateway import AUTH, BODY, make_app
from app.services.household_ai_protocol import SYSTEM_PROMPT

PATH = "/v1/assistant/analyze"
CAPABILITIES = "/v1/assistant/capabilities"


@pytest.mark.parametrize("path", [PATH, CAPABILITIES, "/v1/assistant/plan", "/v1/assistant/report"])
@pytest.mark.parametrize("method", ["get", "post"])
def test_all_private_household_routes_authenticate_before_parse(path, method):
    with TestClient(make_app()) as client:
        response = client.request(method, path, content="private broken json")
    assert response.status_code == 401 and "private" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_capabilities_are_nonbilled_and_decimal_protocol_is_exact(monkeypatch):
    calls = []
    def complete(messages, **options):
        calls.append((messages, options))
        return {"proposals": [{"kind": "transaction", "source_text": "1250.25 تومان دادم",
                               "type": "expense", "amount": Decimal("1250.25")}],
                "unsupported": []}
    monkeypatch.setattr(gateway, "request_deepseek_json", complete)
    with TestClient(make_app()) as client:
        assert client.get(CAPABILITIES, headers=AUTH).json()["protocol_version"] == 2
        assert calls == []
        result = client.post(
            PATH, headers=AUTH, json={"text": "1250.25 تومان دادم", "scope": "finance"},
        )
        assert result.json()["proposals"][0]["amount"] == "1250.25"
    assert len(calls) == 1 and calls[0][0][0]["content"] == SYSTEM_PROMPT
    assert calls[0][1]["model"] == "deepseek-flash"


@pytest.mark.parametrize("extra", [
    {"model": "custom"}, {"messages": []},
    {"url": "https://evil.invalid"}, {"account_id": "private"},
])
def test_household_gateway_is_not_an_open_chat_proxy(monkeypatch, extra):
    monkeypatch.setattr(
        gateway, "request_deepseek_json", lambda *_args, **_kwargs: pytest.fail("must not bill"),
    )
    with TestClient(make_app()) as client:
        response = client.post(PATH, headers=AUTH, json={"text": "private", **extra})
    assert response.status_code == 422 and "private" not in response.text


def test_shared_capacity_cannot_be_bypassed_using_new_endpoint(monkeypatch):
    calls = []
    monkeypatch.setattr(
        gateway, "request_deepseek",
        lambda *_args, **_kwargs: calls.append(1) or {"transactions": []},
    )
    with TestClient(make_app(ai_gateway_requests_per_minute=1)) as client:
        assert client.post(gateway.PRIVATE_PATH, headers=AUTH, json=BODY).status_code == 200
        assert client.get(CAPABILITIES, headers=AUTH).status_code == 200
        result = client.post(PATH, headers=AUTH, json={"text": "نظافت کن"}).json()
        assert result["error"] == "AI_GATEWAY_BUSY"
    assert calls == [1]


def test_household_streamed_body_limit_and_output_schema(monkeypatch):
    monkeypatch.setattr(
        gateway, "request_deepseek_json",
        lambda *_args, **_kwargs: {"proposals": [], "sql": "private"},
    )
    with TestClient(make_app()) as client:
        response = client.post(PATH, headers=AUTH, content=(b"x" * 10000 for _ in range(28)))
        assert response.status_code == 413
        result = client.post(PATH, headers=AUTH, json={"text": "نظافت کن"})
        assert result.status_code == 502 and "private" not in result.text


@pytest.mark.parametrize(("path", "body", "result"), [
    ("/v1/assistant/plan", {"text": "نون نداریم برای صبحونه", "reference_date": "2026-11-23"},
     {"sections": ["inventory", "meals", "shopping"], "terms": ["نان"], "proposals": []}),
    ("/v1/assistant/report", {"text": "نون نداریم", "context_json": '{"facts":[],"actions":[]}'},
     {"finding_ids": [], "options": [], "questions": []}),
])
def test_contextual_routes_validate_and_use_one_official_inference(monkeypatch, path, body, result):
    calls = []
    monkeypatch.setattr(gateway, "request_deepseek_json",
                        lambda messages, **options: calls.append((messages, options)) or result)
    with TestClient(make_app()) as client:
        response = client.post(path, headers=AUTH, json=body)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        for extra in [{"model": "custom"}, {"url": "https://evil.invalid"}, {"messages": []}]:
            assert client.post(path, headers=AUTH, json={**body, **extra}).status_code == 422
    assert len(calls) == 1 and calls[0][1]["model"] == "deepseek-flash"
    assert calls[0][0][0]["content"] != SYSTEM_PROMPT


@pytest.mark.parametrize("path,body", [
    ("/v1/assistant/plan", {"text": "private", "reference_date": "2026-11-23"}),
    ("/v1/assistant/report", {"text": "private", "context_json": "{}"}),
])
def test_contextual_schema_failure_does_not_retry_or_echo_data(monkeypatch, path, body):
    calls = []
    monkeypatch.setattr(gateway, "request_deepseek_json",
                        lambda *_args, **_options: calls.append(1) or {"sql": "private"})
    with TestClient(make_app()) as client:
        response = client.post(path, headers=AUTH, json=body)
    assert response.status_code == 502 and "private" not in response.text
    assert calls == [1]
