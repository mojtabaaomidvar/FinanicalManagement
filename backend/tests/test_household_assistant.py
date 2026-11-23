"""No billed inference: preparation contracts and data boundaries in isolated PostgreSQL."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.core.config import settings
from app.services import household_assistant as assistant
from app.services.financial_text import normalize_financial_text
from tests.conftest import API, expect_status


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "")
    monkeypatch.setattr(settings, "deepseek_api_key", "synthetic-test-key")
    calls, output = [], {"proposals": [], "unsupported": []}

    def complete(messages, **options):
        calls.append((messages, options))
        return {key: [{**row, "source_text": normalize_financial_text(row["source_text"])}
                      for row in rows] for key, rows in output.items()}

    monkeypatch.setattr(assistant, "request_deepseek", complete)
    return calls, output


def analyze(client, home, text, scope="auto"):
    return client.post(
        f"{API}/assistant/analyze", headers=home.h, json={"text": text, "scope": scope},
    )


def finance(text, amount=250000, **patch):
    return {"kind": "transaction", "source_text": text, "type": "expense", "amount": amount,
            "unit": "toman", "category": "food", **patch}


def test_mixed_requests_only_prepare_and_mask_personal_accounts(client, home_a, member_a, provider):
    calls, output = provider
    def account(who, card):
        return expect_status(client.post(API + "/accounts", headers=who.h, json={
            "member_id": who.member_id, "title": "حساب", "card_number": card,
        }), 201).json()
    own = account(home_a, "6037991234567890")
    other = account(member_a, "6037991234567882")
    text = "امروز 250000 تومان برای میوه خرج کردم؛ شیر و نان به خرید اضافه کن؛ فردا نظافت کنم"
    output["proposals"] = [finance("امروز 250000 تومان برای میوه خرج کردم"),
                           {"kind": "shopping_item", "source_text": "شیر و نان به خرید اضافه کن",
                            "title": "شیر"},
                           {"kind": "shopping_item", "source_text": "شیر و نان به خرید اضافه کن",
                            "title": "نان"},
                           {"kind": "task", "source_text": "فردا نظافت کنم", "title": "نظافت"}]
    raw = text + " کارت 6037991234567890 و کارت 6037991234567882 موبایل 09121234567"
    paths = ["/transactions", "/sms?status=pending", "/shopping/lists", "/tasks", "/inventory"]
    before = {path: client.get(API + path, headers=home_a.h).json() for path in paths}
    result = expect_status(analyze(client, home_a, raw), 200).json()
    assert [row["kind"] for row in result["proposals"]] == [
        "transaction", "shopping_item", "shopping_item", "task",
    ]
    assert result["proposals"][0]["amount"] == "250000"
    assert result["proposals"][0]["date"] == result["reference_date"]
    payload = json.loads(calls[0][0][1]["content"])
    assert "6037991234567890" not in payload["text"] and "6037991234567882" not in payload["text"]
    assert "09121234567" not in payload["text"] and payload["account_aliases"] == ["A1"]
    assert own["id"] not in str(payload) and other["id"] not in str(payload)
    for path, rows in before.items():
        assert client.get(API + path, headers=home_a.h).json() == rows
    assert len(calls) == 1


@pytest.mark.parametrize(("text", "amount", "expected", "unit"), [
    ("امروز ۲۵۰ هزار تومان خرج کردم", 250000, "250000", "toman"),
    ("برای خرید ۱۲۵۰٫۲۵ تومان پرداخت کردم", Decimal("1250.25"), "1250.25", "toman"),
    ("برای خرید ۱۲۵۰٫۲۵ تومان پرداخت کردم", 1250, None, None),
    ("برای کرایه 40000 دادم", 40000, "40000", None),
    ("واریز مبلغ 10000 ریال؛ موجودی 50000 ریال", 50000, None, None),
    ("واریز مبلغ 10000 ریال؛ موجودی 50000 ریال", 10000, "10000", "rial"),
    ("10000 ریال و 10000 تومان پرداخت کردم", 10000, "10000", None),
])
def test_money_is_exact_event_grounded_and_not_balance(
    client, home_a, provider, text, amount, expected, unit,
):
    calls, output = provider
    output["proposals"] = [finance(normalize_financial_text(text), amount,
                                   type="income" if "واریز" in text else "expense")]
    result = expect_status(analyze(client, home_a, text), 200).json()["proposals"][0]
    assert result["amount"] == expected and result["unit"] == unit
    assert len(calls) == 1


@pytest.mark.parametrize("text", ["این ماه 250000 تومان خرج کردم؟", "250000 تومان خرج نکردم",
                                 "می‌خواهم 250000 تومان پرداخت کنم", "خرید 250000 تومان انجام نشده",
                                 "برداشت 250000 تومان نمی‌کنم", "واریز 250000 تومان نمی‌شود",
                                 "اگر 250000 تومان برداشت شد خبر بده",
                                 "امروز 10000 تومان دادم و فردا 50000 تومان خرید دارم"])
def test_questions_and_future_or_negated_events_cannot_be_transactions(
    client, home_a, provider, text,
):
    _, output = provider
    output["proposals"] = [finance(text)]
    result = expect_status(analyze(client, home_a, text), 200).json()
    assert result["proposals"] == [] and result["unsupported"][0]["reason"] == "unsupported_action"


def test_scope_rejects_other_kinds_without_legacy_fallback(client, home_a, provider):
    _, output = provider
    output["proposals"] = [{"kind": "task", "title": "نظافت", "source_text": "نظافت کن"}]
    result = expect_status(analyze(client, home_a, "نظافت کن", "shopping"), 200).json()
    assert not result["proposals"] and result["unsupported"][0]["reason"] == "scope_mismatch"


@pytest.mark.parametrize("patch", [
    {"url": "https://evil.invalid"}, {"assignee_id": "arbitrary"}, {"repeat": "daily"},
])
def test_extra_execution_fields_fail_closed_without_echo(client, home_a, provider, patch):
    _, output = provider
    output["proposals"] = [{"kind": "task", "source_text": "نظافت کن", "title": "نظافت", **patch}]
    response = analyze(client, home_a, "نظافت کن")
    assert response.status_code == 502 and "arbitrary" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_fabricated_evidence_and_excess_proposals_are_rejected(client, home_a, provider):
    _, output = provider
    output["proposals"] = [{"kind": "task", "source_text": "شاهد ساختگی", "title": "نظافت"}]
    assert analyze(client, home_a, "نظافت کن").status_code == 502
    output["proposals"] = [{"kind": "task", "source_text": "نظافت کن", "title": "نظافت"}] * 11
    assert analyze(client, home_a, "نظافت کن").status_code == 502


@pytest.mark.parametrize(("text", "expected", "review"), [
    ("امروز", "2026-11-23", False), ("دیروز", "2026-11-22", False), ("پریروز", "2026-11-21", False),
    ("فردا", "2026-11-24", False), ("پس‌فردا", "2026-11-25", False),
    ("پنج‌شنبه", "2026-11-26", True), ("امروز و فردا", None, True),
    ("سه‌شنبه", "2026-11-24", True), ("سه شنبه", "2026-11-24", True),
    ("1405/07/31", None, True), ("2026/02/30", None, True),
    ("1405/09/02", "2026-11-23", False),
])
def test_dates_are_local_calendar_days_with_explicit_weekday_review(text, expected, review):
    day, needs_review = assistant.resolve_day(text, date(2026, 11, 23), future=True)
    assert (day.isoformat() if day else None, needs_review) == (expected, review)


def test_quantity_and_schedule_require_own_evidence(client, home_a, provider):
    _, output = provider
    output["proposals"] = [
        {"kind": "shopping_item", "source_text": "شیر اضافه کن", "title": "شیر", "qty": 9,
         "unit": "لیتر"},
        {"kind": "task", "source_text": "پنج‌شنبه ساعت 8 نظافت کن", "title": "نظافت"},
    ]
    result = expect_status(
        analyze(client, home_a, "شیر اضافه کن؛ پنج‌شنبه ساعت 8 نظافت کن"), 200,
    ).json()
    assert result["proposals"][0]["qty"] is None and result["proposals"][0]["unit"] is None
    assert "date" in result["proposals"][1]["warnings"]
    assert result["unsupported"][0]["reason"] == "unsupported_schedule"


def test_public_api_auth_validation_and_capabilities_do_not_bill(client, home_a, provider):
    calls, _ = provider
    assert client.get(API + "/assistant/capabilities").status_code == 401
    assert client.post(
        API + "/assistant/analyze", json={"text": "private", "scope": "auto"},
    ).status_code == 401
    assert analyze(client, home_a, " ").status_code == 422
    assert analyze(client, home_a, "x" * 8001).status_code == 422
    assert client.get(API + "/assistant/capabilities", headers=home_a.h).json()["status"] == "ready"
    assert calls == []


@pytest.mark.parametrize(("status", "expected"), [
    (404, "upgrade_required"), (401, "misconfigured"), (503, "unavailable"), (302, "unavailable"),
])
def test_old_gateway_and_failures_do_not_trigger_provider_fallback(
    client, home_a, provider, monkeypatch, status, expected,
):
    calls, _ = provider
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "https://private.invalid/ai-gateway")
    monkeypatch.setattr(settings, "ai_sms_gateway_token", "a" * 32)
    gateway_calls = []

    def request(method, url, **options):
        gateway_calls.append((method, url, options))
        assert options["follow_redirects"] is False
        return httpx.Response(status, json={"error": "untrusted", "message": "do not display"})

    monkeypatch.setattr(assistant.httpx, "request", request)
    capability = client.get(API + "/assistant/capabilities", headers=home_a.h).json()
    assert capability["status"] == expected
    assert analyze(client, home_a, "نظافت کن").status_code == 503
    assert calls == [] and len(gateway_calls) == 2


@pytest.mark.parametrize("invalid", [
    [], {"status": "ready", "protocol_version": True,
         "kinds": ["transaction", "shopping_item", "task"]},
    {"status": "ready", "protocol_version": 99, "kinds": []},
])
def test_invalid_gateway_capabilities_are_not_ready(client, home_a, provider, monkeypatch, invalid):
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "https://private.invalid/ai-gateway")
    monkeypatch.setattr(settings, "ai_sms_gateway_token", "a" * 32)
    monkeypatch.setattr(assistant, "_gateway_request", lambda *_: invalid)
    capability = client.get(API + "/assistant/capabilities", headers=home_a.h).json()
    assert capability["status"] == "upgrade_required"
