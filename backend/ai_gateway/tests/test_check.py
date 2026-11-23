"""Official DeepSeek checks authenticate the model list and probe exactly once."""

from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from ai_gateway import check
from app.services.sms_ai_provider import provider_error

KEY = "sk-synthetic-private-deepseek-key"
GOOD = {"transactions": [{"source_index": Decimal(0), "type": "income",
                          "amount": Decimal(10000), "unit": "rial"}]}


@pytest.mark.parametrize("status,listed,expected", [(200, True, 0), (200, False, 1),
                                                 (401, True, 1), (429, True, 1)])
def test_authenticated_list_and_one_synthetic_request(
    monkeypatch, capsys, status, listed, expected,
):
    calls, probes = [], []

    def respond(request):
        calls.append(request)
        assert str(request.url) == "https://api.deepseek.com/models"
        assert request.headers["Authorization"] == "Bearer " + KEY
        return httpx.Response(status, json={"data": [{"id": "deepseek-flash"}] if listed else []})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    config = check_config()
    monkeypatch.setattr(check.httpx, "Client", lambda **_options: client)
    monkeypatch.setattr(check, "GatewaySettings", lambda: config)
    monkeypatch.setattr(check.sys, "argv", ["check.py", "--analyze"])
    monkeypatch.setattr(check, "request_deepseek", lambda *a, **kw: probes.append((a, kw)) or GOOD)
    assert check.main() == expected
    assert len(calls) == 1 and len(probes) == (1 if expected == 0 else 0)
    assert KEY not in capsys.readouterr().out


def check_config():
    return check.GatewaySettings(deepseek_api_key=KEY, ai_sms_model="deepseek-flash")


def test_failed_analysis_never_switches_model_or_provider(monkeypatch, capsys):
    config = check_config()
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(
        200, json={"data": [{"id": "deepseek-flash"}]},
    )))
    monkeypatch.setattr(check.httpx, "Client", lambda **_options: client)
    monkeypatch.setattr(check, "GatewaySettings", lambda: config)
    monkeypatch.setattr(check.sys, "argv", ["check.py", "--analyze"])
    calls = []

    def reject(*_a, **_kw):
        calls.append(1)
        raise provider_error("AI_PROVIDER_CREDIT_REQUIRED")

    monkeypatch.setattr(check, "request_deepseek", reject)
    assert check.main() == 1 and calls == [1]
    assert "AI_PROVIDER_CREDIT_REQUIRED" in capsys.readouterr().out
    assert config.ai_sms_model == "deepseek-flash"


@pytest.mark.parametrize("payload", [{"transactions": []}, {"transactions": [
    {"source_index": 0, "type": "income", "amount": 50000, "unit": "rial"},
]}, {"transactions": [{"source_index": True, "type": "income", "amount": 10000, "unit": "rial"}]}])
def test_structured_but_inaccurate_synthetic_output_is_not_ready(payload):
    assert not check.valid_analysis(payload)


def test_legacy_selection_flag_is_rejected_before_any_network(monkeypatch):
    monkeypatch.setattr(check.sys, "argv", ["check.py", "--select-free"])
    monkeypatch.setattr(check.httpx, "Client", lambda **_kw: pytest.fail("Network"))
    assert check.main() == 1
