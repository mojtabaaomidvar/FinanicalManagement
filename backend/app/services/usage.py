"""Anonymous module counters. No identity, request body, amount or event log."""

import logging
import re
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import get_args
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.support import SupportAiCounter, SupportUsageCounter
from app.schemas.support import SupportModuleUsage, SupportRecordCounts, SupportUsage, UsageModule
from app.services.clock import utcnow

MODULES = get_args(UsageModule)
AI_STAGES = frozenset({"sms", "assistant_analyze", "assistant_plan", "assistant_report"})
logger = logging.getLogger(__name__)
RESOURCE_MODULE = {
    "transactions": "transactions", "accounts": "accounts", "category-budgets": "budgets",
    "bills": "bills", "events": "calendar", "shopping": "shopping", "inventory": "inventory",
    "tasks": "tasks", "documents": "documents", "meals": "meals", "equipment": "equipment",
    "vehicles": "vehicles", "goals": "goals", "activities": "activities", "children": "children",
    "pets": "pets", "holdings": "market", "members": "settings", "family": "settings",
    "subcategories": "settings", "custom-categories": "settings", "sms": "settings", "notifications": "notifications",
}


def successful_operation(path: str, method: str) -> tuple[str, str] | None:
    if path == "/api/v1/shopping/offline/mutations":
        # The validated route supplies a fixed semantic classification to middleware.
        return None
    if method not in {"POST", "PATCH", "DELETE"} or path == "/api/v1/events/sync-birthdays":
        return None
    match = re.fullmatch(r"/api/v1/([a-z-]+)(?:/(.*))?", path)
    if not match or match[1] not in RESOURCE_MODULE:
        return None
    module = RESOURCE_MODULE[match[1]]
    tail = match[2] or ""
    if method == "DELETE":
        return module, "delete"
    if any(tail.endswith(action) for action in ("/complete", "/pay", "/buy", "/settle")):
        return module, "complete"
    if method == "POST" and (not tail or tail in {"lists", "dishes", "plan"}):
        return module, "create"
    return module, "update"


def record(module: str, action: str) -> None:
    if module not in MODULES or action not in {"open", "create", "update", "complete", "delete"}:
        return
    hour = utcnow().astimezone(ZoneInfo("Asia/Tehran")).replace(
        minute=0, second=0, microsecond=0,
    ).astimezone(UTC)
    try:
        with SessionLocal() as db:
            statement = insert(SupportUsageCounter).values(hour=hour, module=module, action=action, count=1)
            db.execute(statement.on_conflict_do_update(
                index_elements=[SupportUsageCounter.hour, SupportUsageCounter.module, SupportUsageCounter.action],
                set_={"count": SupportUsageCounter.count + 1}))
            db.commit()
    except Exception:
        # Analytics must never alter the original financial result or log its data.
        logger.warning("Usage counter unavailable")


def record_ai(
    stage: str,
    status: str,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    """Record one provider call without identity, prompt, response or content."""
    if stage not in AI_STAGES or status not in {"success", "failure"}:
        return
    from app.services.sms_ai_provider import token_count

    input_tokens, output_tokens = token_count(input_tokens), token_count(output_tokens)
    input_value, output_value = input_tokens or 0, output_tokens or 0
    input_known, output_known = int(input_tokens is not None), int(output_tokens is not None)
    hour = utcnow().astimezone(ZoneInfo("Asia/Tehran")).replace(
        minute=0, second=0, microsecond=0
    ).astimezone(UTC)
    try:
        with SessionLocal() as db:
            statement = insert(SupportAiCounter).values(
                hour=hour,
                stage=stage,
                status=status,
                requests=1,
                input_tokens=input_value,
                output_tokens=output_value,
                input_token_requests=input_known,
                output_token_requests=output_known,
            )
            db.execute(statement.on_conflict_do_update(
                index_elements=[
                    SupportAiCounter.hour, SupportAiCounter.stage, SupportAiCounter.status,
                ],
                set_={
                    "requests": SupportAiCounter.requests + 1,
                    "input_tokens": SupportAiCounter.input_tokens + input_value,
                    "output_tokens": SupportAiCounter.output_tokens + output_value,
                    "input_token_requests": SupportAiCounter.input_token_requests + input_known,
                    "output_token_requests": SupportAiCounter.output_token_requests + output_known,
                },
            ))
            db.commit()
    except Exception:
        logger.warning("AI usage counter unavailable")


@contextmanager
def measure_ai(stage: str):
    from app.services.sms_ai_provider import capture_ai_usage
    from app.services.ai_controls import release_call, reserve_call

    lease = None

    def before_attempt():
        nonlocal lease
        lease = reserve_call()

    with capture_ai_usage(before_attempt) as usage:
        status = "failure"
        try:
            yield
            status = "success"
        finally:
            release_call(lease)
            if usage.attempted:
                record_ai(
                    stage, status, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
                )


def offline_operation(kind: str) -> tuple[str, str] | None:
    entity, _, action = kind.partition(".")
    module = {
        "list": "shopping", "item": "shopping", "inventory": "inventory", "task": "tasks",
    }.get(entity)
    if module is None or action not in {
        "create", "update", "delete", "check", "adjust", "complete",
    }:
        return None
    return module, "update" if action in {"check", "adjust"} else action


def report(db: Session, days: int) -> SupportUsage:
    now = utcnow()
    first_day = now.astimezone(ZoneInfo("Asia/Tehran")).date() - timedelta(days=days-1)
    start = datetime.combine(first_day, datetime.min.time(), ZoneInfo("Asia/Tehran"))
    rows = db.execute(select(SupportUsageCounter.module, SupportUsageCounter.action, func.sum(SupportUsageCounter.count))
        .where(SupportUsageCounter.hour >= start).group_by(SupportUsageCounter.module, SupportUsageCounter.action)).all()
    totals = {(module, action): count for module, action, count in rows}
    modules = [SupportModuleUsage(module=module, opens=totals.get((module, "open"), 0),
        creates=totals.get((module, "create"), 0), updates=totals.get((module, "update"), 0),
        completes=totals.get((module, "complete"), 0), deletes=totals.get((module, "delete"), 0)) for module in MODULES]
    bucket = func.date(func.timezone("Asia/Tehran", SupportUsageCounter.hour))
    daily_rows = db.execute(select(bucket, SupportUsageCounter.action, func.sum(SupportUsageCounter.count))
        .where(SupportUsageCounter.hour >= start).group_by(bucket, SupportUsageCounter.action)).all()
    day_totals = {}
    for day, action, count in daily_rows:
        totals_for_day = day_totals.setdefault(day, {"opens": 0, "operations": 0})
        totals_for_day["opens" if action == "open" else "operations"] += count
    daily = [{"day": (first_day+timedelta(days=index)).isoformat(),
              **day_totals.get(first_day+timedelta(days=index), {"opens": 0, "operations": 0})} for index in range(days)]
    since = db.execute(select(func.min(SupportUsageCounter.hour))).scalar_one()
    counts = db.execute(text("SELECT * FROM public.support_record_counts()")).mappings().one()
    return SupportUsage(days=days, modules=modules, daily=daily,
                        records=SupportRecordCounts(**counts), measured_since=since, checked_at=now)
