"""Independent aggregate AI report; the released product report stays unchanged."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import model_validator

from app.management.analytics import Aggregate, Count, Days, period
from app.management.contracts import ManagementError

STAGES = ("sms", "assistant_analyze", "assistant_plan", "assistant_report")
Stage = Literal["sms", "assistant_analyze", "assistant_plan", "assistant_report"]


class AiTotals(Aggregate):
    requests: Count
    successes: Count
    failures: Count
    input_tokens: Count | None
    output_tokens: Count | None
    input_token_requests: Count
    output_token_requests: Count

    @model_validator(mode="after")
    def consistent(self):
        if self.successes + self.failures != self.requests:
            raise ValueError("Inconsistent AI outcomes")
        for direction in ("input", "output"):
            known = getattr(self, direction + "_token_requests")
            tokens = getattr(self, direction + "_tokens")
            if known > self.requests or (known == 0) != (tokens is None):
                raise ValueError("Unknown AI usage must not be zero")
        return self


class AiStage(AiTotals):
    stage: Stage


class AiReport(Aggregate):
    days: Days
    start_at: datetime
    checked_at: datetime
    available: bool
    first_counter: datetime | None
    totals: AiTotals | None
    stages: list[AiStage] | None

    @model_validator(mode="after")
    def consistent(self):
        if self.start_at.tzinfo is None or self.checked_at.tzinfo is None:
            raise ValueError("AI report requires timezones")
        if self.available != (self.totals is not None and self.stages is not None):
            raise ValueError("Unavailable AI counters must remain null")
        if not self.available and (
            self.totals is not None or self.stages is not None or self.first_counter is not None
        ):
            raise ValueError("Unavailable AI report has data")
        if self.stages is not None:
            if [row.stage for row in self.stages] != list(STAGES):
                raise ValueError("AI stages must be complete and ordered")
            for key in AiTotals.model_fields:
                expected = sum(getattr(row, key) or 0 for row in self.stages)
                actual = getattr(self.totals, key)
                if actual is not None and actual != expected:
                    raise ValueError("Inconsistent AI totals")
        return self


def validate_ai_report(data: dict) -> dict:
    try:
        return AiReport.model_validate_json(json.dumps(data)).model_dump(mode="json")
    except ValueError as exc:
        raise ManagementError(
            "AI_ANALYTICS_INVALID",
            "ساختار گزارش مصرف هوش مصنوعی معتبر نیست؛ دوباره بررسی کنید.", 503,
        ) from exc


AI_SQL = """SELECT json_build_object(
    'since', (SELECT min(hour) FROM public.support_ai_counters WHERE hour < :'as_of'::timestamptz),
    'stages', (SELECT coalesce(json_agg(t),'[]'::json) FROM (
        SELECT stage, sum(requests) AS requests,
            coalesce(sum(requests) FILTER (WHERE status='success'),0) AS successes,
            coalesce(sum(requests) FILTER (WHERE status='failure'),0) AS failures,
            sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
            sum(input_token_requests) AS input_token_requests,
            sum(output_token_requests) AS output_token_requests
        FROM public.support_ai_counters
        WHERE hour >= :'start'::timestamptz AND hour < :'as_of'::timestamptz
        GROUP BY stage ORDER BY stage
    ) t)
);"""


def _totals(rows):
    result = {key: sum(row[key] or 0 for row in rows) for key in AiTotals.model_fields}
    for direction in ("input", "output"):
        if not result[direction + "_token_requests"]:
            result[direction + "_tokens"] = None
    return result


def read_ai_analytics(sql, days: int, now: datetime | None = None) -> dict:
    start, now = period(days, now)
    parameters = {"start": start.isoformat(), "as_of": now.isoformat()}

    def query(statement):
        return json.loads(sql("BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='10s';\n"
                              + statement + "\nCOMMIT;", parameters))

    available = query("SELECT to_json(to_regclass('public.support_ai_counters') IS NOT NULL);")
    result = {"days": days, "start_at": start.isoformat(), "checked_at": now.isoformat(),
              "available": available, "first_counter": None, "totals": None, "stages": None}
    if available:
        raw = query(AI_SQL)
        found = {}
        for row in raw["stages"]:
            # Fail closed on unknown dimensions or invalid counters, before any export.
            for direction in ("input", "output"):
                if row[direction + "_token_requests"] == 0:
                    row[direction + "_tokens"] = None
            validated = AiStage.model_validate(row).model_dump()
            found[validated["stage"]] = validated
        empty = {"requests": 0, "successes": 0, "failures": 0, "input_tokens": None,
                 "output_tokens": None, "input_token_requests": 0, "output_token_requests": 0}
        stages = [found.get(stage, {"stage": stage, **empty}) for stage in STAGES]
        result.update(first_counter=raw["since"], stages=stages, totals=_totals(stages))
    return validate_ai_report(result)


def demo_ai_analytics(users: list[dict], days: int, now: datetime | None = None) -> dict:
    start, now = period(days, now)
    rows = []
    for index, stage in enumerate(STAGES):
        count = (index + 1) * 3 if users else 0
        rows.append({"stage": stage, "requests": count, "successes": max(0, count - 1),
                     "failures": int(count > 0), "input_tokens": count * 240 if count else None,
                     "output_tokens": count * 80 if count else None,
                     "input_token_requests": count, "output_token_requests": count})
    return validate_ai_report({
        "days": days, "start_at": start.isoformat(), "checked_at": now.isoformat(),
        "available": True, "first_counter": start.isoformat() if users else None,
        "totals": _totals(rows), "stages": rows,
    })
