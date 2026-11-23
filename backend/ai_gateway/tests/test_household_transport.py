"""Exercise the real provider parser; replace only the outbound HTTP response."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from ai_gateway.tests.test_gateway import AUTH, BODY, make_app
from app.services import sms_ai_provider as provider

TEXT = "نون نداریم برای صبحونه"
PLAN_BODY = {"text": TEXT, "reference_date": "2026-11-23"}
REPORT_BODY = {"text": TEXT, "context_json": '{"facts":[],"actions":[]}'}


@pytest.mark.parametrize(("path", "body", "output"), [
    ("/v1/sms/analyze", BODY, {"transactions": []}),
    ("/v1/assistant/analyze", {"text": TEXT}, {"proposals": [], "unsupported": []}),
    ("/v1/assistant/plan", PLAN_BODY,
     {"sections": ["meals", "inventory", "shopping"], "terms": ["نان"], "proposals": []}),
    ("/v1/assistant/report", REPORT_BODY, {"finding_ids": [], "options": [], "questions": []}),
])
def test_each_route_accepts_its_own_contract_through_real_transport(
    monkeypatch, path, body, output,
):
    calls = []

    def respond(url, **options):
        assert url == "https://api.deepseek.com/chat/completions"
        assert options["json"]["model"] == "deepseek-flash"
        assert options["json"]["thinking"] == {"type": "disabled"}
        assert options["follow_redirects"] is False
        calls.append(options["json"])
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"finish_reason": "stop", "message": {
                "content": json.dumps(output, ensure_ascii=False),
            }}],
        })

    monkeypatch.setattr(provider.httpx, "post", respond)
    with TestClient(make_app()) as client:
        result = client.post(path, headers=AUTH, json=body)
    assert result.status_code == 200, result.text
    assert len(calls) == 1
    assert result.headers["cache-control"] == "no-store"
    assert all(result.json()[key] == value for key, value in output.items())


@pytest.mark.parametrize(("path", "body", "output"), [
    ("/v1/sms/analyze", BODY, {"sections": []}),
    ("/v1/assistant/analyze", {"text": TEXT}, {"transactions": []}),
    ("/v1/assistant/plan", PLAN_BODY, {"sql": "private-household-record"}),
    ("/v1/assistant/report", REPORT_BODY, {"sections": []}),
])
def test_cross_contract_or_arbitrary_output_is_rejected_without_retry(
    monkeypatch, path, body, output,
):
    calls = []

    def respond(url, **_options):
        calls.append(url)
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(output)}}],
        })

    monkeypatch.setattr(provider.httpx, "post", respond)
    with TestClient(make_app()) as client:
        result = client.post(path, headers=AUTH, json=body)
    assert result.status_code == 502 and result.json()["error"] == "AI_INVALID_RESULT"
    assert len(calls) == 1 and "private-household-record" not in result.text


@pytest.mark.parametrize("failure", ["status", "timeout", "invalid", "truncated"])
def test_context_transport_failure_is_safe_and_never_retried(monkeypatch, caplog, failure):
    calls = []

    def respond(url, **_options):
        calls.append(url)
        request = httpx.Request("POST", url)
        if failure == "timeout":
            raise httpx.ReadTimeout("private-provider-key", request=request)
        if failure == "status":
            return httpx.Response(402, request=request, json={"error": "private-provider-key"})
        return httpx.Response(200, request=request, json={"choices": [{
            "finish_reason": "length" if failure == "truncated" else "stop",
            "message": {"content": "private-invalid-json"},
        }]})

    monkeypatch.setattr(provider.httpx, "post", respond)
    with TestClient(make_app()) as client:
        result = client.post("/v1/assistant/plan", headers=AUTH, json=PLAN_BODY)
    expected = {"status": "AI_PROVIDER_CREDIT_REQUIRED", "timeout": "AI_PROVIDER_TIMEOUT",
                "invalid": "AI_INVALID_RESULT", "truncated": "AI_INVALID_RESULT"}[failure]
    assert result.json()["error"] == expected and result.status_code >= 400
    assert len(calls) == 1 and "private-" not in result.text + caplog.text
