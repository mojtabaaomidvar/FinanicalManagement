"""Public API -> private gateway -> real JSON parser; only provider HTTP is fictional."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from ai_gateway.tests.test_gateway import TOKEN, make_app
from app.core.config import settings
from app.services import household_assistant, sms_ai_provider
from tests.conftest import API
from tests.test_household_context import seed_breakfast

TEXT = "نون نداریم برای صبحونه"
PATHS = ["/transactions", "/shopping/lists", "/tasks", "/inventory", "/meals/dishes"]


@pytest.fixture
def real_transport(monkeypatch):
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "https://gateway.invalid/ai-gateway")
    monkeypatch.setattr(settings, "ai_sms_gateway_token", TOKEN)
    monkeypatch.setattr(settings, "deepseek_api_key", "")
    state = {"provider_calls": [], "gateway_calls": [], "failure": None, "fail_at": 1}

    def respond(url, **options):
        assert url == "https://api.deepseek.com/chat/completions"
        assert options["json"]["model"] == "deepseek-flash"
        request = httpx.Request("POST", url)
        data = json.loads(options["json"]["messages"][1]["content"])
        state["provider_calls"].append(data)
        failure = state["failure"] if len(state["provider_calls"]) == state["fail_at"] else None
        if failure == "credit":
            return httpx.Response(402, request=request, json={"error": "private-provider-data"})
        if failure == "timeout":
            raise httpx.ReadTimeout("private-provider-data", request=request)
        if "context_json" not in data:
            output = {"sections": ["meals", "inventory", "shopping"], "terms": ["نان"],
                      "proposals": []}
        else:
            context = json.loads(data["context_json"])
            output = {"finding_ids": [fact["id"] for fact in context["facts"]],
                      "options": [{"title": "خرید نان", "action_ids": [item["id"]
                                   for item in context["actions"]
                                   if item["kind"] == "shopping_item"]}], "questions": []}
        content = json.dumps({"sql": "private-provider-data"} if failure == "schema" else output,
                             ensure_ascii=False)
        if failure == "invalid":
            content = "private-invalid-json"
        return httpx.Response(200, request=request, json={"choices": [{
            "finish_reason": "stop", "message": {"content": content},
        }]})

    monkeypatch.setattr(sms_ai_provider.httpx, "post", respond)
    with TestClient(make_app()) as gateway:
        def request(method, url, **options):
            prefix = "https://gateway.invalid/ai-gateway"
            assert url.startswith(prefix) and options["follow_redirects"] is False
            path = url.removeprefix(prefix)
            assert path in {"/v1/assistant/plan", "/v1/assistant/report"}
            state["gateway_calls"].append(path)
            return gateway.request(method, path, headers=options["headers"], json=options["json"])

        monkeypatch.setattr(household_assistant.httpx, "request", request)
        yield state


@pytest.mark.parametrize("direct", [False, True])
def test_public_report_uses_real_parser_twice_and_preserves_household_records(
    client, home_a, real_transport, monkeypatch, direct,
):
    if direct:
        monkeypatch.setattr(settings, "ai_sms_gateway_url", "")
        monkeypatch.setattr(settings, "deepseek_api_key", "sk-fictional-direct-test")
    seed_breakfast(client, home_a, 0)
    before = {path: client.get(API + path, headers=home_a.h).json() for path in PATHS}
    response = client.post(API + "/assistant/report", headers=home_a.h, json={"text": TEXT})
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["inferences"] == len(real_transport["provider_calls"]) == 2
    assert len(real_transport["gateway_calls"]) == (0 if direct else 2)
    assert value["proposals"] == [] and any(fact["kind"] == "dish" for fact in value["facts"])
    assert next(fact for fact in value["facts"] if fact["kind"] == "dish")["status"] == "missing"
    assert "price" not in str(value["actions"])
    assert {path: client.get(API + path, headers=home_a.h).json() for path in PATHS} == before


@pytest.mark.parametrize("fail_at", [1, 2])
@pytest.mark.parametrize(("failure", "code"), [
    ("invalid", "AI_INVALID_RESULT"), ("schema", "AI_INVALID_RESULT"),
    ("credit", "AI_PROVIDER_CREDIT_REQUIRED"), ("timeout", "AI_PROVIDER_TIMEOUT"),
])
def test_public_report_preserves_safe_failure_code_without_retry_or_write(
    client, home_a, real_transport, fail_at, failure, code,
):
    seed_breakfast(client, home_a, 0)
    before = {path: client.get(API + path, headers=home_a.h).json() for path in PATHS}
    real_transport.update(failure=failure, fail_at=fail_at)
    response = client.post(API + "/assistant/report", headers=home_a.h, json={"text": TEXT})
    assert response.status_code >= 400 and response.json()["error"] == code
    assert "private-" not in response.text and TEXT not in response.text
    assert len(real_transport["provider_calls"]) == len(real_transport["gateway_calls"]) == fail_at
    assert {path: client.get(API + path, headers=home_a.h).json() for path in PATHS} == before


@pytest.mark.parametrize("payload", [
    {"error": "untrusted", "message": "private-provider-data"},
    {"error": ["AI_INVALID_RESULT"]}, {"error": {}}, [], None,
])
def test_gateway_unknown_or_malformed_errors_never_select_remote_display_copy(
    monkeypatch, payload,
):
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "https://gateway.invalid")
    monkeypatch.setattr(settings, "ai_sms_gateway_token", TOKEN)
    monkeypatch.setattr(household_assistant.httpx, "request", lambda *_args, **_options:
                        httpx.Response(502, json=payload))
    from app.core.errors import AppError

    with pytest.raises(AppError) as error:
        household_assistant._gateway_request("/v1/assistant/plan", {})
    assert error.value.code == "AI_GATEWAY_UNAVAILABLE"
    assert "private-" not in error.value.message
