"""The installer's HTTPS check must accept the gateway's exact Decimal wire format."""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient

from ai_gateway import check, install
from ai_gateway.app import GatewaySettings, create_app
from app.services import sms_ai_provider


def synthetic(index=0, amount=10000):
    return {"transactions": [{
        "source_index": index, "amount": amount, "type": "income", "unit": "rial",
    }]}


@pytest.mark.parametrize("index", [0, Decimal(0), "0", "0.0"])
def test_checks_accept_exact_zero_index_without_requiring_a_json_number(index):
    payload = synthetic(index, "10000.00")
    assert check.valid_analysis(payload)
    assert install.valid_analysis(payload)


@pytest.mark.parametrize("index", [True, False, None, [], {}, "", "wrong", 1, "1",
                                 "0.1", "NaN", "Infinity", "-Infinity"])
def test_wrong_or_invalid_indexes_are_never_coerced_to_zero(index):
    payload = synthetic(index)
    assert not check.valid_analysis(payload)
    assert not install.valid_analysis(payload)


@pytest.mark.parametrize("amount", [True, False, None, "NaN", "Infinity", "10000.01", "50000"])
def test_exact_amount_validation_remains_required(amount):
    payload = synthetic("0", amount)
    assert not check.valid_analysis(payload)
    assert not install.valid_analysis(payload)


def test_real_provider_parser_and_gateway_serialization_pass_the_https_verifier(monkeypatch):
    """Mock only the external network, not the Decimal parser or gateway JSON encoding."""
    calls = []

    def complete(url, **options):
        calls.append((url, options))
        assert url == "https://api.deepseek.com/chat/completions"
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"finish_reason": "stop", "message": {
                "content": json.dumps(synthetic()),
            }}],
        })

    monkeypatch.setattr(sms_ai_provider.httpx, "post", complete)
    token = "t" * 43
    app = create_app(GatewaySettings(
        deepseek_api_key="synthetic-private-key", ai_gateway_token=token,
    ))
    with TestClient(app) as client:
        response = client.post("/v1/sms/analyze", headers={"Authorization": "Bearer " + token},
                               json=install.SYNTHETIC_BODY)
    assert response.status_code == 200
    wire = response.json()
    assert wire["transactions"][0]["source_index"] == "0"
    assert wire["transactions"][0]["amount"] == "10000"
    assert install.valid_analysis(wire)
    assert check.valid_analysis(wire)
    assert len(calls) == 1
