"""Real PostgreSQL aggregate recording; all provider calls are synthetic."""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import text

from app.core.errors import AppError
from app.services import sms_ai_provider as provider
from app.services import usage
from tests.test_shopping_offline import mutation, send


def counters(raw_sql):
    return [dict(row) for row in raw_sql.execute(text("SELECT * FROM support_ai_counters ORDER BY stage,status")).mappings()]


def test_aggregate_upsert_tehran_hour_partial_usage_and_no_identity(raw_sql, monkeypatch):
    monkeypatch.setattr(usage, "utcnow", lambda: datetime(2026, 11, 25, 20, 45, tzinfo=UTC))
    usage.record_ai("sms", "success", input_tokens=10, output_tokens=0)
    usage.record_ai("sms", "success", input_tokens=4)
    usage.record_ai("sms", "failure")
    usage.record_ai("private-prompt", "success", input_tokens=999)
    rows = counters(raw_sql)
    assert len(rows) == 2
    success = next(row for row in rows if row["status"] == "success")
    assert success["hour"] == datetime(2026, 11, 25, 20, 30, tzinfo=UTC)
    assert success["requests"] == 2 and success["input_tokens"] == 14 and success["output_tokens"] == 0
    assert success["input_token_requests"] == 2 and success["output_token_requests"] == 1
    assert set(success) == {"hour", "stage", "status", "requests", "input_tokens", "output_tokens", "input_token_requests", "output_token_requests"}
    assert "private" not in json.dumps(rows, default=str)


@pytest.mark.parametrize("value", [True, -1, 1.5, "10", 2**63])
def test_invalid_provider_counts_stay_unknown(raw_sql, value):
    usage.record_ai("sms", "success", input_tokens=value, output_tokens=value)
    row = counters(raw_sql)[0]
    assert row["input_token_requests"] == row["output_token_requests"] == 0
    assert row["input_tokens"] == row["output_tokens"] == 0


def test_concurrent_requests_do_not_lose_counts(raw_sql):
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: usage.record_ai("assistant_plan", "success", input_tokens=2, output_tokens=3), range(18)))
    row = counters(raw_sql)[0]
    assert (row["requests"], row["input_tokens"], row["output_tokens"]) == (18, 36, 54)


def test_provider_failure_keeps_known_usage_and_unknown_timeout(raw_sql, monkeypatch):
    def response(*args, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"),
                              json={"usage": {"prompt_tokens": 12, "completion_tokens": 3},
                                    "choices": [{"finish_reason": "length", "message": {"content": "PRIVATE"}}]})
    monkeypatch.setattr(provider.httpx, "post", response)
    with pytest.raises(AppError), usage.measure_ai("sms"):
        provider.request_deepseek_json([], api_key="synthetic", model="synthetic", timeout=1)
    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("PRIVATE-PROMPT")
    monkeypatch.setattr(provider.httpx, "post", timeout)
    with pytest.raises(AppError), usage.measure_ai("sms"):
        provider.request_deepseek_json([], api_key="synthetic", model="synthetic", timeout=1)
    row = counters(raw_sql)[0]
    assert row["status"] == "failure" and row["requests"] == 2
    assert row["input_tokens"] == 12 and row["output_tokens"] == 3
    assert row["input_token_requests"] == row["output_token_requests"] == 1


def test_missing_configuration_does_not_claim_a_call(raw_sql):
    with pytest.raises(AppError), usage.measure_ai("sms"):
        provider.request_deepseek_json([], api_key="", model="synthetic", timeout=1)
    assert counters(raw_sql) == []


def test_measurement_failure_never_breaks_ai_or_logs_content(monkeypatch, caplog):
    def unavailable():
        raise RuntimeError("PRIVATE-DB-ERROR")
    monkeypatch.setattr(usage, "SessionLocal", unavailable)
    with usage.measure_ai("sms"):
        provider.ai_attempt_started()
    assert "AI usage counter unavailable" in caplog.text
    assert "PRIVATE" not in caplog.text


def test_gateway_numeric_headers_old_gateway_and_context_isolation():
    with provider.capture_ai_usage() as first:
        provider.capture_gateway_usage(httpx.Headers({"X-AI-Usage-Version": "1", "X-AI-Input-Tokens": "0", "X-AI-Output-Tokens": "7"}))
        assert first.input_tokens == 0 and first.output_tokens == 7
        with provider.capture_ai_usage() as second:
            provider.capture_gateway_usage(httpx.Headers({"X-AI-Input-Tokens": "999"}))
            assert second.input_tokens is None
        assert first.output_tokens == 7


def test_gateway_rejection_before_inference_does_not_count_a_model_call(raw_sql):
    with usage.measure_ai("sms"):
        provider.ai_attempt_started()
        provider.capture_gateway_usage(httpx.Headers({
            "X-AI-Usage-Version": "1", "X-AI-Attempted": "0",
            "X-AI-Input-Tokens": "999",
        }))
    assert counters(raw_sql) == []


def test_offline_successes_are_classified_by_module_and_replays_keep_request_meaning(client, home_a, raw_sql):
    stock_id, list_id, task_id = (str(uuid.uuid4()) for _ in range(3))
    stock = mutation("inventory.create", stock_id, None, title="PRIVATE-STOCK", quantity=1)
    send(client, home_a, stock)
    assert send(client, home_a, stock)["replayed"] is True
    send(client, home_a, mutation("inventory.adjust", stock_id, 1, delta=2))
    send(client, home_a, mutation("inventory.adjust", stock_id, 1, delta=2), 409)
    send(client, home_a, mutation("list.create", list_id, None, title="PRIVATE-LIST"))
    send(client, home_a, mutation("task.create", task_id, None, title="PRIVATE-TASK"))
    send(client, home_a, mutation("task.complete", task_id, 1, completed=True))
    rows = raw_sql.execute(text("SELECT module,action,count FROM support_usage_counters ORDER BY module,action")).all()
    assert sorted(tuple(row) for row in rows) == [
        ("inventory", "create", 2), ("inventory", "update", 1), ("shopping", "create", 1),
        ("tasks", "complete", 1), ("tasks", "create", 1),
    ]


@pytest.mark.parametrize("kind,expected", [
    ("item.create", ("shopping", "create")), ("item.check", ("shopping", "update")),
    ("list.delete", ("shopping", "delete")), ("inventory.delete", ("inventory", "delete")),
    ("task.update", ("tasks", "update")), ("task.delete", ("tasks", "delete")),
    ("private.create", None),
])
def test_offline_fixed_classification(kind, expected):
    assert usage.offline_operation(kind) == expected
    assert usage.successful_operation("/api/v1/shopping/offline/mutations", "POST") is None
