"""Only numeric provider metadata crosses the private gateway; response bodies stay compatible."""
import httpx
import pytest
from fastapi.testclient import TestClient

from ai_gateway.app import GatewaySettings, create_app
from app.services import sms_ai_provider

AUTH = {"Authorization": "Bearer " + "x" * 40}
BODY = {"items": [{"source_index": 0, "text": "متن ساختگی", "account_aliases": []}]}


@pytest.mark.parametrize("valid,status", [(True, 200), (False, 502)])
def test_numeric_usage_survives_valid_and_invalid_provider_content(monkeypatch, valid, status):
    def post(*args, **kwargs):
        return httpx.Response(
            200, request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"),
            json={"usage": {"prompt_tokens": 11, "completion_tokens": 0}, "choices": [{
                "finish_reason": "stop", "message": {
                    "content": '{"transactions":[]}' if valid else "PRIVATE-INVALID",
                },
            }]},
        )
    monkeypatch.setattr(sms_ai_provider.httpx, "post", post)
    config = GatewaySettings(deepseek_api_key="synthetic", ai_gateway_token="x" * 40)
    with TestClient(create_app(config)) as client:
        result = client.post("/v1/sms/analyze", headers=AUTH, json=BODY)
    assert result.status_code == status
    assert result.headers["X-AI-Input-Tokens"] == "11"
    assert result.headers["X-AI-Output-Tokens"] == "0"
    assert result.headers["X-AI-Usage-Version"] == "1"
    assert "PRIVATE" not in result.text
    assert "usage" not in result.json()


def test_gateway_capacity_and_auth_rejections_report_no_provider_attempt(monkeypatch):
    def post(*args, **kwargs):
        sms_ai_provider.ai_attempt_started()
        return {"transactions": []}

    monkeypatch.setattr("ai_gateway.app.request_deepseek", post)
    config = GatewaySettings(
        deepseek_api_key="synthetic", ai_gateway_token="x" * 40,
        ai_gateway_requests_per_minute=1,
    )
    with TestClient(create_app(config)) as client:
        first = client.post("/v1/sms/analyze", headers=AUTH, json=BODY)
        busy = client.post("/v1/sms/analyze", headers=AUTH, json=BODY)
        unauthorized = client.post("/v1/sms/analyze", json=BODY)
        invalid = client.post("/v1/sms/analyze", headers=AUTH, json={"private": "text"})
    assert first.headers["X-AI-Attempted"] == "1"
    for result in (busy, unauthorized, invalid):
        assert result.is_error
        assert result.headers["X-AI-Attempted"] == "0"
        assert "X-AI-Input-Tokens" not in result.headers
