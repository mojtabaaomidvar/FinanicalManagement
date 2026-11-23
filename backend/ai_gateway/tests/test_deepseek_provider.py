"""Official DeepSeek transport: one bounded request, safe errors, exact JSON amounts."""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from app.core.errors import AppError
from app.services import sms_ai_provider as provider
from app.services.sms_ai_protocol import build_messages

KEY = "sk-synthetic-deepseek-private-key"
SMS = "واریز مبلغ ۱۰۰۰۰ ریال؛ موجودی ۵۰۰۰۰ ریال"


def complete(payload=None, *, content=None, finish="stop"):
    return {"choices": [{"finish_reason": finish, "message": {
        "content": content if content is not None else json.dumps(
            payload if payload is not None else {"transactions": []},
        ),
    }}]}


def invoke():
    return provider.request_deepseek(
        build_messages([{"source_index": 0, "text": SMS, "account_aliases": []}]),
        api_key=KEY, model="deepseek-flash", timeout=25,
    )


def test_request_uses_only_official_api_and_disables_thinking_without_retry(monkeypatch):
    calls = []

    def respond(url, **options):
        calls.append((url, options))
        return httpx.Response(200, request=httpx.Request("POST", url), json=complete(
            content='{"transactions":[{"source_index":0,"amount":10000.125}]}',
        ))

    monkeypatch.setattr(provider.httpx, "post", respond)
    result = invoke()
    assert result["transactions"][0]["amount"] == Decimal("10000.125")
    assert len(calls) == 1
    url, options = calls[0]
    assert url == "https://api.deepseek.com/chat/completions"
    assert options["headers"]["Authorization"] == "Bearer " + KEY
    assert options["follow_redirects"] is False and options["timeout"] == 25
    body = options["json"]
    assert body["model"] == "deepseek-flash"
    assert body["thinking"] == {"type": "disabled"}
    assert body["response_format"] == {"type": "json_object"}
    assert body["stream"] is False and body["max_tokens"] == 1800
    assert "JSON" in body["messages"][0]["content"]
    assert "tools" not in body and "reasoning_effort" not in body


@pytest.mark.parametrize("status,code", [
    (400, "AI_PROVIDER_INVALID_REQUEST"), (422, "AI_PROVIDER_INVALID_REQUEST"),
    (401, "AI_PROVIDER_KEY_REJECTED"), (402, "AI_PROVIDER_CREDIT_REQUIRED"),
    (403, "AI_ACCESS_DENIED"), (404, "AI_MODEL_UNAVAILABLE"),
    (429, "AI_PROVIDER_RATE_LIMITED"), (500, "AI_UNAVAILABLE"),
    (503, "AI_UNAVAILABLE"), (408, "AI_PROVIDER_TIMEOUT"),
    (504, "AI_PROVIDER_TIMEOUT"), (307, "AI_UNAVAILABLE"),
])
def test_status_is_safe_and_does_not_retry_or_change_provider(monkeypatch, caplog, status, code):
    calls = []
    monkeypatch.setattr(provider.logger, "disabled", False)

    def respond(url, **_options):
        calls.append(url)
        return httpx.Response(status, request=httpx.Request("POST", url), json={
            "error": {"message": KEY + SMS},
        })

    monkeypatch.setattr(provider.httpx, "post", respond)
    with pytest.raises(AppError) as error:
        invoke()
    assert error.value.code == code
    assert len(calls) == 1 and calls[0].startswith("https://api.deepseek.com/")
    assert KEY not in str(error.value) + caplog.text
    assert SMS not in str(error.value) + caplog.text


@pytest.mark.parametrize("body", [
    {}, {"choices": []}, complete(content=" "), complete(content="private-invalid-json"),
    complete(payload=[]), complete(payload={}), complete(payload={"transactions": {}}),
    complete(finish="length"), complete(finish="content_filter"),
    complete(content='{"transactions":[{"amount":NaN}]}'),
    complete(content='{"transactions":[{"amount":Infinity}]}'),
    complete(payload={"transactions": [{}] * 81}),
])
def test_invalid_blank_nonfinite_or_truncated_result_is_not_success(monkeypatch, body):
    monkeypatch.setattr(provider.httpx, "post", lambda url, **_options: httpx.Response(
        200, request=httpx.Request("POST", url), json=body,
    ))
    with pytest.raises(AppError) as error:
        invoke()
    assert error.value.code == "AI_INVALID_RESULT"


def test_missing_key_does_not_contact_a_provider(monkeypatch):
    monkeypatch.setattr(provider.httpx, "post", lambda *_a, **_kw: pytest.fail("Network request"))
    with pytest.raises(AppError) as error:
        provider.request_deepseek([], api_key="", model="deepseek-flash", timeout=25)
    assert error.value.code == "AI_NOT_CONFIGURED"
