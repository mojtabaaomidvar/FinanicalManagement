"""Aggregate analytics must be useful without exporting any household-level data."""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime, timedelta
from typing import get_args
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.management.analytics import (
    MODULES,
    demo_analytics,
    period,
    read_analytics,
    validate_report,
)
from app.management.contracts import Config, ManagementError
from app.management.identity import create_account
from app.management.main import create_app
from app.schemas.support import UsageModule

NOW = datetime(2026, 11, 25, 8, 42, tzinfo=UTC)
ORIGIN = "http://127.0.0.1:5710"
PASSWORD = "analytics-test-password"
PRIVATE = "private-content-must-never-leave-sql"
USERS = [
    {
        "id": "private-member-id",
        "family_id": "private-family-id",
        "name": PRIVATE,
        "phone": "09123456789",
        "password_hash": PRIVATE,
        "state": "active",
        "created_at": (NOW - timedelta(days=8)).isoformat(),
        "last_login": (NOW - timedelta(hours=1)).isoformat(),
    }
]


def assert_aggregate_only(report):
    forbidden = {
        "id",
        "member_id",
        "family_id",
        "name",
        "phone",
        "password_hash",
        "amount",
        "title",
        "body",
        "content",
        "ip",
        "user_agent",
        "token",
    }

    def visit(value):
        if isinstance(value, dict):
            assert not (set(value) & forbidden)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(report)
    encoded = json.dumps(report)
    for value in (PRIVATE, "09123456789", "private-member-id", "private-family-id"):
        assert value not in encoded


@pytest.mark.parametrize("days", [7, 30, 90])
def test_period_demo_and_export_have_only_aggregates(days):
    result = demo_analytics(USERS, days, NOW)
    assert len(result["daily"]) == days
    assert result["daily"][-1]["day"] == "2026-11-25"
    assert result["snapshot"]["families"] == 1
    assert result["snapshot"]["registered_accounts"] == 1
    assert result["usage"]["requests"] == sum(point["requests"] for point in result["daily"])
    assert result["measurement"]["website"] == "not_measured"
    assert result["measurement"]["unique_active_users"] == "not_measured"
    assert_aggregate_only(result)


def test_module_inventory_matches_existing_anonymous_counter_contract():
    assert MODULES == get_args(UsageModule)


def test_demo_periods_are_nested_and_empty_is_not_unavailable():
    week = demo_analytics(USERS, 7, NOW)
    month = demo_analytics(USERS, 30, NOW)
    assert week["usage"]["requests"] <= month["usage"]["requests"]
    empty = demo_analytics([], 7, NOW)
    assert empty["snapshot"]["families"] == 0
    assert empty["usage"] == {"opens": 0, "requests": 0}
    assert empty["measurement"]["usage_available"] is True
    assert empty["measurement"]["first_usage_counter"] is None


@pytest.mark.parametrize("days", [1, 0, -1, 365, 9999999, "30", True, None])
def test_period_cannot_be_an_arbitrary_query_or_unbounded_window(days):
    with pytest.raises(ManagementError, match="INVALID_PERIOD"):
        period(days, NOW)


def test_absent_optional_counters_remain_null_and_queries_are_read_only():
    snapshot = demo_analytics([], 7, NOW)["snapshot"]
    calls = []

    def sql(statement, parameters):
        calls.append(statement)
        assert statement.startswith("BEGIN TRANSACTION READ ONLY;")
        assert "statement_timeout='10s'" in statement
        assert parameters["as_of"] == NOW.isoformat()
        if "to_regclass" in statement:
            return json.dumps({"usage": False, "errors": False, "records": False})
        if "pg_catalog.pg_tables" in statement:
            return "{}"
        if "NULL::bigint" in statement:
            from app.management.analytics import INVENTORY_QUERIES

            return json.dumps(dict.fromkeys(INVENTORY_QUERIES))
        return json.dumps({"snapshot": snapshot, "families_daily": [], "registrations_daily": []})

    result = read_analytics(sql, 7, NOW)
    assert len(calls) == 4
    assert result["usage"] is None and result["modules"] is None and result["records"] is None
    assert result["errors"] is None
    assert all(value is None for value in result["record_inventory"].values())
    assert all(
        point["opens"] is None and point["requests"] is None and point["errors"] is None
        for point in result["daily"]
    )
    assert_aggregate_only(result)


@pytest.mark.parametrize(
    "mutation",
    [
        "private_field",
        "negative_count",
        "bool_count",
        "unknown_module",
        "missing_day",
        "wrong_total",
        "partial_unmeasured",
    ],
)
def test_response_boundary_rejects_sensitive_or_misleading_data(mutation):
    report = demo_analytics(USERS, 7, NOW)
    if mutation == "private_field":
        report["members"] = [{"name": PRIVATE, "phone": "09123456789"}]
    elif mutation == "negative_count":
        report["snapshot"]["families"] = -1
    elif mutation == "bool_count":
        report["snapshot"]["families"] = True
    elif mutation == "unknown_module":
        report["modules"][0]["module"] = PRIVATE
    elif mutation == "missing_day":
        report["daily"].pop()
    elif mutation == "wrong_total":
        report["usage"]["requests"] += 1
    else:
        report["measurement"]["usage_available"] = False
    with pytest.raises(ManagementError, match="ANALYTICS_INVALID"):
        validate_report(report)


@pytest.fixture
def application(tmp_path):
    config = Config(
        mode="demo", origin=ORIGIN, state_dir=tmp_path / "state", web_root=tmp_path / "web"
    )
    return create_app(config)


@pytest.mark.parametrize("role", ["owner", "operator", "viewer"])
@pytest.mark.parametrize("section", ["analytics", "ai-analytics"])
def test_analytics_requires_management_auth_and_is_available_to_all_management_roles(
    application, role, section
):
    create_account(application.state.store, role, PASSWORD, role, production=False)
    with TestClient(application, base_url=ORIGIN) as client:
        assert client.get(f"/management/api/state/{section}").status_code == 401
        login = client.post(
            "/management/api/login",
            json={"username": role, "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert login.status_code == 200
        before = application.state.driver.path.read_bytes()
        for days in (7, 30, 90):
            result = client.get(f"/management/api/state/{section}?days={days}")
            assert result.status_code == 200, result.text
            assert result.json()["days"] == days
            assert result.headers["cache-control"] == "no-store"
            assert_aggregate_only(result.json())
        assert application.state.driver.path.read_bytes() == before
        assert application.state.store.jobs() == []
        for days in (1, -1, 10000, "invalid"):
            assert client.get(f"/management/api/state/analytics?days={days}").status_code == 422


def test_http_boundary_does_not_forward_accidental_private_fields(application):
    create_account(application.state.store, "owner", PASSWORD, "owner", production=False)
    report = demo_analytics(USERS, 7, NOW)
    report["phone"] = "09123456789"
    with TestClient(application, base_url=ORIGIN) as client:
        client.post(
            "/management/api/login",
            json={"username": "owner", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        with patch.object(application.state.driver, "read", return_value=copy.deepcopy(report)):
            result = client.get("/management/api/state/analytics?days=7")
        assert result.status_code == 503
        assert result.json()["error"] == "ANALYTICS_INVALID"
        assert "09123456789" not in result.text and PRIVATE not in result.text
