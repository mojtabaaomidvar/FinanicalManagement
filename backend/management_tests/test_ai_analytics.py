import json
from datetime import UTC, datetime

import pytest

from app.management.ai_analytics import demo_ai_analytics, read_ai_analytics, validate_ai_report
from app.management.contracts import ManagementError

NOW = datetime(2026, 11, 26, 8, tzinfo=UTC)


def test_missing_and_empty_ai_counters_are_distinct():
    statements = []
    def sql(statement, parameters):
        statements.append(statement)
        return "false"
    result = read_ai_analytics(sql, 7, NOW)
    assert result["available"] is False and result["totals"] is None and result["stages"] is None
    assert len(statements) == 1
    assert "READ ONLY" in statements[0] and "statement_timeout" in statements[0]
    empty = demo_ai_analytics([], 7, NOW)
    assert empty["available"] is True and empty["totals"]["requests"] == 0
    assert empty["totals"]["input_tokens"] is None and empty["first_counter"] is None


def test_partial_unknown_tokens_and_tehran_window():
    def sql(statement, parameters):
        assert parameters["start"] == "2026-11-20T00:00:00+03:30"
        if "to_regclass" in statement:
            return "true"
        return json.dumps({"since": "2026-11-26T07:30:00Z", "stages": [
            {"stage": "sms", "requests": 4, "successes": 3, "failures": 1,
             "input_tokens": 20, "output_tokens": 0,
             "input_token_requests": 2, "output_token_requests": 1},
        ]})
    result = read_ai_analytics(sql, 7, NOW)
    assert result["totals"] == {"requests": 4, "successes": 3, "failures": 1, "input_tokens": 20,
                                "output_tokens": 0, "input_token_requests": 2,
                                "output_token_requests": 1}
    assert len(result["stages"]) == 4
    assert result["stages"][1]["input_tokens"] is None


@pytest.mark.parametrize("change", [
    {"family_id": "PRIVATE"}, {"totals": None}, {"available": False},
])
def test_ai_contract_rejects_private_extra_fields_and_inconsistent_data(change):
    value = demo_ai_analytics([], 30, NOW)
    value.update(change)
    with pytest.raises(ManagementError):
        validate_ai_report(value)


def test_ai_contract_rejects_unknown_as_zero_and_bad_totals():
    for key, value in (("input_tokens", 0), ("requests", 1)):
        report = demo_ai_analytics([], 30, NOW)
        report["totals"][key] = value
        with pytest.raises(ManagementError):
            validate_ai_report(report)
