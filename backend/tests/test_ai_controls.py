"""Real database limits and feature access; no real inference or manual sandbox data."""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.errors import AppError
from app.services import ai_controls, sms_ai_provider, usage
from tests.test_shopping_offline import mutation, send


@pytest.fixture
def limits(monkeypatch):
    for key in ("ai_requests_per_day", "ai_family_requests_per_day", "ai_max_concurrent"):
        monkeypatch.setattr(settings, key, 0)
    monkeypatch.setattr(settings, "rate_limit_salt", "synthetic-ai-limits-salt")
    return monkeypatch


def test_daily_family_limit_shared_across_members_and_independent_of_other_families(
    limits, raw_sql,
):
    limits.setattr(settings, "ai_family_requests_per_day", 2)
    for _ in range(2):
        with ai_controls.for_family("PRIVATE-FAMILY-A"):
            ai_controls.reserve_call()
    with ai_controls.for_family("PRIVATE-FAMILY-A"), pytest.raises(AppError) as blocked:
        ai_controls.reserve_call()
    assert blocked.value.code == "AI_DAILY_LIMIT"
    with ai_controls.for_family("PRIVATE-FAMILY-B"):
        ai_controls.reserve_call()
    rows = raw_sql.execute(text("SELECT scope,requests FROM ai_daily_allowances")).all()
    assert sorted(row.requests for row in rows) == [1, 2]
    assert all(len(row.scope) == 64 and "PRIVATE" not in row.scope for row in rows)
    assert raw_sql.execute(text("SELECT count(*) FROM support_ai_counters")).scalar_one() == 0


def test_global_daily_limit_is_atomic_under_parallel_inferences(limits, raw_sql):
    limits.setattr(settings, "ai_requests_per_day", 5)

    def attempt(_):
        try:
            ai_controls.reserve_call()
            return True
        except AppError as error:
            assert error.code == "AI_DAILY_LIMIT"
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        accepted = list(pool.map(attempt, range(15)))
    assert sum(accepted) == 5
    assert raw_sql.execute(text("SELECT requests FROM ai_daily_allowances")).scalar_one() == 5


def test_shared_concurrency_releases_after_success_and_failed_provider(limits, raw_sql):
    limits.setattr(settings, "ai_max_concurrent", 1)
    lease = ai_controls.reserve_call()
    with pytest.raises(AppError) as blocked:
        ai_controls.reserve_call()
    assert blocked.value.code == "AI_CAPACITY_REACHED"
    ai_controls.release_call(lease)
    with pytest.raises(RuntimeError), usage.measure_ai("sms"):
        sms_ai_provider.ai_attempt_started()
        raise RuntimeError("synthetic provider failure")
    assert raw_sql.execute(text("SELECT count(*) FROM ai_capacity_leases")).scalar_one() == 0
    ai_controls.release_call(ai_controls.reserve_call())


def test_expired_lease_and_daily_tehran_reset(limits, raw_sql):
    limits.setattr(settings, "ai_max_concurrent", 1)
    limits.setattr(settings, "ai_requests_per_day", 1)
    now = datetime(2026, 11, 26, 20, 29, tzinfo=UTC)
    limits.setattr(ai_controls, "utcnow", lambda: now)
    lease = ai_controls.reserve_call()
    with pytest.raises(AppError):
        ai_controls.reserve_call()
    now += timedelta(minutes=2)
    replacement = ai_controls.reserve_call()
    assert replacement != lease
    assert raw_sql.execute(text("SELECT count(*) FROM ai_daily_allowances")).scalar_one() == 2
    now += timedelta(days=3)
    ai_controls.release_call(ai_controls.reserve_call())
    assert raw_sql.execute(text("SELECT count(*) FROM ai_daily_allowances")).scalar_one() == 1


def test_limit_rejects_before_transport_and_does_not_invent_ai_counter(limits, raw_sql):
    limits.setattr(settings, "ai_requests_per_day", 1)
    ai_controls.reserve_call()
    called = []
    limits.setattr(sms_ai_provider.httpx, "post", lambda *a, **k: called.append(True))
    with pytest.raises(AppError) as blocked, usage.measure_ai("sms"):
        sms_ai_provider.request_deepseek_json([], api_key="synthetic", model="test", timeout=1)
    assert blocked.value.code == "AI_DAILY_LIMIT"
    assert called == []
    assert raw_sql.execute(text("SELECT count(*) FROM support_ai_counters")).scalar_one() == 0


def test_direct_output_token_limit_reaches_provider(limits):
    captured = []

    def post(*args, **options):
        captured.append(options["json"])
        return httpx.Response(200, request=httpx.Request("POST", "https://api.deepseek.com"), json={
            "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
        })

    limits.setattr(sms_ai_provider.httpx, "post", post)
    sms_ai_provider.request_deepseek_json(
        [], api_key="synthetic", model="test", timeout=1, max_output_tokens=512,
    )
    assert captured[0]["max_tokens"] == 512


@pytest.mark.parametrize("mode,gateway,expected", [
    ("auto", "", "direct"), ("auto", "https://private.invalid", "gateway"),
    ("direct", "https://private.invalid", "direct"), ("gateway", "", "gateway"),
])
def test_explicit_transport_selection(limits, mode, gateway, expected):
    limits.setattr(settings, "ai_connection_mode", mode)
    limits.setattr(settings, "ai_sms_gateway_url", gateway)
    assert ai_controls.connection_mode() == expected


def test_disabled_transport_is_explicit(limits):
    limits.setattr(settings, "ai_connection_mode", "disabled")
    with pytest.raises(AppError) as blocked:
        ai_controls.connection_mode()
    assert blocked.value.code == "ASSISTANT_DISABLED"


def test_offline_domain_policy_preserves_data_and_unrelated_sync(
    client, home_a, tmp_path, monkeypatch,
):
    stock_id, task_id = str(uuid.uuid4()), str(uuid.uuid4())
    send(client, home_a, mutation(
        "inventory.create", stock_id, None, title="PRIVATE-STOCK", quantity=2,
    ))
    task = mutation("task.create", task_id, None, title="PRIVATE-TASK")
    send(client, home_a, task)
    path = tmp_path / "runtime.json"
    path.write_text(json.dumps({
        "feature_inventory": "read_only", "feature_tasks": "disabled",
    }))
    monkeypatch.setenv("KHANEYAR_RUNTIME_FILE", str(path))
    assert send(client, home_a, task)["replayed"] is True
    blocked = client.post("/api/v1/shopping/offline/mutations", headers=home_a.h,
                          json=mutation("inventory.adjust", stock_id, 1, delta=-1))
    assert blocked.status_code == 503 and blocked.json()["error"] == "FEATURE_READ_ONLY"
    send(client, home_a, mutation("list.create", str(uuid.uuid4()), None, title="Unrelated"))
    snapshot = client.get("/api/v1/shopping/offline", headers=home_a.h).json()
    assert snapshot["tasks"] == []
    assert str(snapshot["inventory"][0]["quantity"]) in {"2.00", "2.0", "2"}
    assert client.get("/api/v1/tasks", headers=home_a.h).status_code == 503
    path.write_text("{}")
    assert any(row["id"] == task_id for row in client.get("/api/v1/tasks", headers=home_a.h).json())


def test_prepared_assistant_action_cannot_bypass_new_read_only_policy(
    client, home_a, tmp_path, monkeypatch,
):
    from app.services.assistant_actions import sign_payload

    actor = SimpleNamespace(id=home_a.member_id, family_id=home_a.family_id)
    token = sign_payload(actor, {
        "type": "report", "report_id": str(uuid.uuid4()),
        "actions": [{"id": "create-list", "kind": "shopping_list", "title": "Synthetic"}],
    })
    prepared = client.post("/api/v1/assistant/prepare-action", headers=home_a.h, json={
        "report_token": token, "action_id": "create-list", "title": "Synthetic",
    })
    assert prepared.status_code == 200, prepared.text
    path = tmp_path / "runtime.json"
    path.write_text(json.dumps({"feature_shopping": "read_only"}))
    monkeypatch.setenv("KHANEYAR_RUNTIME_FILE", str(path))
    result = client.post("/api/v1/assistant/execute", headers=home_a.h,
                         json={"review_token": prepared.json()["review_token"], "confirmed": True})
    assert result.status_code == 503 and result.json()["error"] == "FEATURE_READ_ONLY"
    assert client.get("/api/v1/shopping/lists", headers=home_a.h).json() == []


def test_disabled_report_source_does_not_reach_context_inference(
    client, home_a, tmp_path, monkeypatch,
):
    from app.services import contextual_assistant

    calls = []

    def plan(*args, **kwargs):
        calls.append(True)
        return {"sections": ["documents"], "terms": [], "proposals": []}

    monkeypatch.setattr(settings, "ai_connection_mode", "direct")
    monkeypatch.setattr(settings, "deepseek_api_key", "synthetic-key")
    monkeypatch.setattr(contextual_assistant, "request_deepseek_json", plan)
    path = tmp_path / "runtime.json"
    path.write_text(json.dumps({"feature_documents": "disabled"}))
    monkeypatch.setenv("KHANEYAR_RUNTIME_FILE", str(path))
    result = client.post("/api/v1/assistant/report", headers=home_a.h,
                         json={"text": "اسناد را بررسی کن"})
    assert result.status_code == 503 and result.json()["error"] == "FEATURE_DISABLED"
    assert calls == [True]


def test_read_only_inventory_prevents_partial_checkout_and_financial_write(
    client, home_a, raw_sql, tmp_path, monkeypatch,
):
    from tests.test_shopping import check, complete, new_item, new_list, new_stock

    stock = new_stock(client, home_a, title="برنج", quantity="1", category="grains")
    parent = new_list(client, home_a)
    item = new_item(client, home_a, parent["id"], title="برنج", qty="2", price="10000",
                    inventory_item_id=stock["id"])
    assert check(client, home_a, item["id"]).status_code == 200
    before = client.get("/api/v1/shopping/lists", headers=home_a.h).json()
    path = tmp_path / "runtime.json"
    path.write_text(json.dumps({"feature_inventory": "read_only"}))
    monkeypatch.setenv("KHANEYAR_RUNTIME_FILE", str(path))
    result = complete(client, home_a, parent["id"])
    assert result.status_code == 503 and result.json()["error"] == "FEATURE_READ_ONLY"
    assert client.get("/api/v1/shopping/lists", headers=home_a.h).json() == before
    assert raw_sql.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 0
