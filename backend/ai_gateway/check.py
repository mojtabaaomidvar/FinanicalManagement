"""Bounded official DeepSeek check; no retries, real SMS, or sensitive diagnostics."""

from __future__ import annotations

import json
import sys
from decimal import Decimal, InvalidOperation

import httpx

from ai_gateway.app import GatewaySettings
from app.core.errors import AppError
from app.services.sms_ai_protocol import build_messages
from app.services.sms_ai_provider import request_deepseek

SYNTHETIC_ITEMS = [{
    "source_index": 0, "text": "واریز مبلغ ۱۰۰۰۰ ریال؛ موجودی ۵۰۰۰۰ ریال", "account_aliases": [],
}]


def verify_offline_transport() -> None:
    """Use the real image parser and route schemas, with only outbound HTTP replaced."""
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from ai_gateway.app import create_app

    token = "offline-contract-check-" + "t" * 32
    config = GatewaySettings(deepseek_api_key="sk-fictional-offline-check",
                             ai_gateway_token=token)
    cases = [
        ("/v1/sms/analyze", {"items": SYNTHETIC_ITEMS}, {"transactions": []}),
        ("/v1/assistant/analyze", {"text": "نون نداریم"}, {"proposals": []}),
        ("/v1/assistant/plan", {"text": "نون نداریم", "reference_date": "2026-11-23"},
         {"sections": ["inventory", "shopping"], "terms": ["نان"], "proposals": []}),
        ("/v1/assistant/report", {"text": "نون نداریم", "context_json": "{}"},
         {"finding_ids": [], "options": [], "questions": []}),
    ]
    calls = []
    output = {}

    def respond(url, **options):
        if url != "https://api.deepseek.com/chat/completions":
            raise RuntimeError("Gateway offline contract check rejected a provider URL.")
        if options["json"]["model"] != "deepseek-flash":
            raise RuntimeError("Gateway offline contract check rejected a model.")
        calls.append(url)
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"finish_reason": "stop", "message": {
                "content": json.dumps(output, ensure_ascii=False),
            }}],
        })

    with patch("app.services.sms_ai_provider.httpx.post", side_effect=respond):
        with TestClient(create_app(config)) as client:
            for path, body, output in cases:
                response = client.post(path, headers={"Authorization": "Bearer " + token},
                                       json=body)
                if response.status_code != 200 or any(
                    response.json().get(key) != value for key, value in output.items()
                ):
                    raise RuntimeError("Gateway offline transport/schema check failed.")
    if len(calls) != len(cases):
        raise RuntimeError("Gateway offline contract check detected an inference retry.")


def valid_analysis(result: dict) -> bool:
    transactions = result.get("transactions")
    if not isinstance(transactions, list) or len(transactions) != 1:
        return False
    row = transactions[0]
    if not isinstance(row, dict):
        return False
    try:
        amount = Decimal(str(row.get("amount")))
        source_index = Decimal(str(row.get("source_index")))
    except (InvalidOperation, ValueError):
        return False
    return (
        not isinstance(row.get("source_index"), bool)
        and source_index.is_finite() and source_index == 0 and row.get("type") == "income"
        and not isinstance(row.get("amount"), bool)
        and amount.is_finite() and amount == 10000
        and row.get("unit") == "rial"
    )


def main() -> int:
    if sys.argv[1:] == ["--offline"]:
        verify_offline_transport()
        print("GATEWAY OFFLINE TRANSPORT READY; no network, key or billed inference used.")
        return 0
    if sys.argv[1:] not in ([], ["--analyze"]):
        print("Use only the optional --analyze flag; model selection is not supported.")
        return 1
    config = GatewaySettings()
    if not config.deepseek_api_key.strip():
        print("DEEPSEEK_API_KEY is not configured on this server.")
        return 1
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            models = client.get("https://api.deepseek.com/models", headers={
                "Authorization": "Bearer " + config.deepseek_api_key.strip(),
            })
            print("DeepSeek authenticated model list HTTP:", models.status_code)
            if models.status_code != 200:
                return 1
            items = models.json().get("data", [])
            available = isinstance(items, list) and any(
                isinstance(item, dict) and item.get("id") == config.ai_sms_model for item in items
            )
            print("Configured model is listed:", available)
            if not available:
                return 1
        if "--analyze" in sys.argv:
            result = request_deepseek(
                build_messages(SYNTHETIC_ITEMS), api_key=config.deepseek_api_key,
                model=config.ai_sms_model, timeout=config.ai_sms_timeout_seconds,
            )
            # The amount is parsed as Decimal by the real transport, never as binary float.
            valid = valid_analysis(result)
            print("Synthetic SMS analysis is accurate:", valid)
            if not valid:
                return 1
    except AppError as error:
        print(json.dumps({"error": error.code, "status": error.http_status}))
        return 1
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        print("The server could not complete the DeepSeek connectivity check.")
        return 1
    print("DEEPSEEK READY: configured key and model verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
