"""Fixed, aggregate-only product reports. No event identities or household content leave SQL."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.management.contracts import ManagementError

MODULES = (
    "dashboard",
    "transactions",
    "accounts",
    "budgets",
    "bills",
    "reports",
    "calendar",
    "shopping",
    "inventory",
    "tasks",
    "documents",
    "meals",
    "equipment",
    "vehicles",
    "goals",
    "activities",
    "children",
    "pets",
    "market",
    "settings",
    "notifications",
)
TEHRAN = ZoneInfo("Asia/Tehran")
Days = Literal[7, 30, 90]
Count = Annotated[int, Field(ge=0)]
# Fixed SELECT statements only. A browser never selects a relation or SQL expression.
INVENTORY_QUERIES = {
    "wallets": ("accounts", "SELECT count(*) FROM public.accounts"),
    "budget_limits": ("category_budgets", "SELECT count(*) FROM public.category_budgets"),
    "bills": ("bills", "SELECT count(*) FROM public.bills"),
    "inventory_items": ("inventory_items", "SELECT count(*) FROM public.inventory_items"),
    "shopping_items": ("shopping_items", "SELECT count(*) FROM public.shopping_items"),
    "meal_dishes": ("meal_dishes", "SELECT count(*) FROM public.meal_dishes"),
    "meal_entries": ("meal_entries", "SELECT count(*) FROM public.meal_entries"),
    "equipment": ("home_equipment", "SELECT count(*) FROM public.home_equipment"),
    "vehicles": ("vehicles", "SELECT count(*) FROM public.vehicles"),
    "maintenance_records": (
        "maintenance_records",
        "SELECT count(*) FROM public.maintenance_records",
    ),
    "calendar_events": ("family_events", "SELECT count(*) FROM public.family_events"),
    "goals": ("goals", "SELECT count(*) FROM public.goals"),
    "pets": ("pets", "SELECT count(*) FROM public.pets"),
    "bank_messages": ("sms_messages", "SELECT count(*) FROM public.sms_messages"),
}


class Aggregate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Snapshot(Aggregate):
    families: Count
    families_with_accounts: Count
    profiles: Count
    registered_accounts: Count
    introduced_profiles: Count
    managed_profiles: Count
    active_accounts: Count
    pending_accounts: Count
    inactive_accounts: Count
    accounts_with_login: Count
    families_with_login: Count
    accounts_without_login_history: Count
    accounts_without_registration_history: Count

    @model_validator(mode="after")
    def consistent(self):
        if (
            self.registered_accounts + self.introduced_profiles + self.managed_profiles
            != self.profiles
        ):
            raise ValueError("Inconsistent account totals")
        if (
            self.active_accounts + self.pending_accounts + self.inactive_accounts
            != self.registered_accounts
        ):
            raise ValueError("Inconsistent membership totals")
        if (
            self.families_with_accounts > self.families
            or self.families_with_login > self.families_with_accounts
        ):
            raise ValueError("Inconsistent family totals")
        if (
            max(
                self.accounts_with_login,
                self.accounts_without_login_history,
                self.accounts_without_registration_history,
            )
            > self.registered_accounts
        ):
            raise ValueError("Inconsistent history totals")
        return self


class ModuleCounts(Aggregate):
    module: str
    opens: Count = 0
    creates: Count = 0
    updates: Count = 0
    completes: Count = 0
    deletes: Count = 0

    @model_validator(mode="after")
    def known_module(self):
        if self.module not in MODULES:
            raise ValueError("Unknown usage module")
        return self


class UsageTotals(Aggregate):
    opens: Count
    requests: Count


class ErrorTotals(Aggregate):
    login: Count
    registration: Count
    server: Count
    total: Count

    @model_validator(mode="after")
    def consistent(self):
        if self.login + self.registration != self.total or self.server > self.total:
            raise ValueError("Inconsistent error totals")
        return self


class RecordCounts(Aggregate):
    transactions: Count
    scheduled_plans: Count
    open_tasks: Count
    completed_tasks: Count
    shopping_lists: Count
    documents: Count


class Daily(Aggregate):
    day: date
    families_created: Count
    registrations_completed: Count
    opens: Count | None
    requests: Count | None
    errors: Count | None


class RecordInventory(Aggregate):
    wallets: Count | None
    budget_limits: Count | None
    bills: Count | None
    inventory_items: Count | None
    shopping_items: Count | None
    meal_dishes: Count | None
    meal_entries: Count | None
    equipment: Count | None
    vehicles: Count | None
    maintenance_records: Count | None
    calendar_events: Count | None
    goals: Count | None
    pets: Count | None
    bank_messages: Count | None


class Measurement(Aggregate):
    usage_available: bool
    errors_available: bool
    records_available: bool
    first_usage_counter: datetime | None
    first_error_counter: datetime | None
    website: Literal["not_measured"] = "not_measured"
    unique_active_users: Literal["not_measured"] = "not_measured"
    retention: Literal["not_measured"] = "not_measured"
    session_duration: Literal["not_measured"] = "not_measured"
    assistant_usage: Literal["not_measured"] = "not_measured"


class ProductReport(Aggregate):
    days: Days
    start_at: datetime
    checked_at: datetime
    snapshot: Snapshot
    daily: list[Daily]
    modules: list[ModuleCounts] | None
    usage: UsageTotals | None
    lifetime_usage: UsageTotals | None
    errors: ErrorTotals | None
    records: RecordCounts | None
    record_inventory: RecordInventory
    measurement: Measurement

    @model_validator(mode="after")
    def consistent(self):
        if self.start_at.tzinfo is None or self.checked_at.tzinfo is None:
            raise ValueError("Report timestamps require timezones")
        first = self.start_at.astimezone(TEHRAN).date()
        if [point.day for point in self.daily] != [
            first + timedelta(days=i) for i in range(self.days)
        ]:
            raise ValueError("Daily report must cover exactly the selected Tehran days")
        usage_parts = (self.modules, self.usage, self.lifetime_usage)
        if (self.measurement.usage_available and any(part is None for part in usage_parts)) or (
            not self.measurement.usage_available and any(part is not None for part in usage_parts)
        ):
            raise ValueError("Missing usage must not be reported as zero")
        if self.measurement.errors_available != (self.errors is not None):
            raise ValueError("Missing errors must not be reported as zero")
        if self.measurement.records_available != (self.records is not None):
            raise ValueError("Missing record counts must not be reported as zero")
        if not self.measurement.usage_available and any(
            point.opens is not None or point.requests is not None for point in self.daily
        ):
            raise ValueError("Unmeasured daily usage must remain null")
        if not self.measurement.errors_available and any(
            point.errors is not None for point in self.daily
        ):
            raise ValueError("Unmeasured daily errors must remain null")
        if self.modules is not None:
            if [row.module for row in self.modules] != list(MODULES):
                raise ValueError("Module inventory must be complete and ordered")
            opens = sum(row.opens for row in self.modules)
            requests = sum(
                row.creates + row.updates + row.completes + row.deletes for row in self.modules
            )
            if self.usage.opens != opens or self.usage.requests != requests:
                raise ValueError("Inconsistent module totals")
            if (
                sum(point.opens or 0 for point in self.daily) != opens
                or sum(point.requests or 0 for point in self.daily) != requests
            ):
                raise ValueError("Inconsistent daily usage")
        if self.errors and sum(point.errors or 0 for point in self.daily) != self.errors.total:
            raise ValueError("Inconsistent daily errors")
        return self


CAPABILITIES_SQL = """SELECT json_build_object(
    'usage', to_regclass('public.support_usage_counters') IS NOT NULL,
    'errors', to_regclass('public.support_error_counters') IS NOT NULL,
    'records', to_regprocedure('public.support_record_counts()') IS NOT NULL);"""

SNAPSHOT_SQL = """WITH people AS (
    SELECT family_id, status, membership_state, support_registered_at, support_last_login_at,
        (status <> 'pending' AND password_hash IS NOT NULL) AS registered,
        (status = 'pending') AS introduced,
        (status <> 'pending' AND password_hash IS NULL) AS managed
    FROM public.members
)
SELECT json_build_object(
    'snapshot', (SELECT json_build_object(
        'families', (SELECT count(*) FROM public.families),
        'families_with_accounts', count(DISTINCT family_id) FILTER (WHERE registered),
        'profiles', count(*),
        'registered_accounts', count(*) FILTER (WHERE registered),
        'introduced_profiles', count(*) FILTER (WHERE introduced),
        'managed_profiles', count(*) FILTER (WHERE managed),
        'active_accounts', count(*) FILTER (WHERE registered AND membership_state='active'),
        'pending_accounts', count(*) FILTER (WHERE registered AND membership_state='pending'),
        'inactive_accounts', count(*) FILTER (
            WHERE registered AND membership_state NOT IN ('active','pending')),
        'accounts_with_login', count(*) FILTER (WHERE registered
            AND support_last_login_at >= :'start'::timestamptz
            AND support_last_login_at < :'as_of'::timestamptz),
        'families_with_login', count(DISTINCT family_id) FILTER (WHERE registered
            AND support_last_login_at >= :'start'::timestamptz
            AND support_last_login_at < :'as_of'::timestamptz),
        'accounts_without_login_history', count(*) FILTER (
            WHERE registered AND support_last_login_at IS NULL),
        'accounts_without_registration_history', count(*) FILTER (
            WHERE registered AND support_registered_at IS NULL)
    ) FROM people),
    'families_daily', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT (created_at AT TIME ZONE 'Asia/Tehran')::date AS day, count(*) AS count
        FROM public.families WHERE created_at >= :'start'::timestamptz
            AND created_at < :'as_of'::timestamptz GROUP BY 1 ORDER BY 1
    ) t),
    'registrations_daily', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT (support_registered_at AT TIME ZONE 'Asia/Tehran')::date AS day,
            count(*) AS count FROM people WHERE registered
            AND support_registered_at >= :'start'::timestamptz
            AND support_registered_at < :'as_of'::timestamptz GROUP BY 1 ORDER BY 1
    ) t)
);"""

USAGE_SQL = """SELECT json_build_object(
    'since', (SELECT min(hour) FROM public.support_usage_counters
        WHERE hour < :'as_of'::timestamptz),
    'lifetime', (SELECT json_build_object(
        'opens', coalesce(sum(count) FILTER (WHERE action='open'),0),
        'requests', coalesce(sum(count) FILTER (WHERE action<>'open'),0)
    ) FROM public.support_usage_counters WHERE hour < :'as_of'::timestamptz),
    'modules', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT module,
            coalesce(sum(count) FILTER (WHERE action='open'),0) AS opens,
            coalesce(sum(count) FILTER (WHERE action='create'),0) AS creates,
            coalesce(sum(count) FILTER (WHERE action='update'),0) AS updates,
            coalesce(sum(count) FILTER (WHERE action='complete'),0) AS completes,
            coalesce(sum(count) FILTER (WHERE action='delete'),0) AS deletes
        FROM public.support_usage_counters WHERE hour >= :'start'::timestamptz
            AND hour < :'as_of'::timestamptz GROUP BY module ORDER BY module
    ) t),
    'daily', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT (hour AT TIME ZONE 'Asia/Tehran')::date AS day,
            coalesce(sum(count) FILTER (WHERE action='open'),0) AS opens,
            coalesce(sum(count) FILTER (WHERE action<>'open'),0) AS requests
        FROM public.support_usage_counters WHERE hour >= :'start'::timestamptz
            AND hour < :'as_of'::timestamptz GROUP BY 1 ORDER BY 1
    ) t)
);"""

ERRORS_SQL = """SELECT json_build_object(
    'since', (SELECT min(hour) FROM public.support_error_counters
        WHERE hour < :'as_of'::timestamptz),
    'totals', (SELECT json_build_object(
        'login', coalesce(sum(count) FILTER (WHERE kind='login'),0),
        'registration', coalesce(sum(count) FILTER (WHERE kind='registration'),0),
        'server', coalesce(sum(count) FILTER (WHERE http_family='server'),0),
        'total', coalesce(sum(count),0)
    ) FROM public.support_error_counters WHERE hour >= :'start'::timestamptz
        AND hour < :'as_of'::timestamptz),
    'daily', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT (hour AT TIME ZONE 'Asia/Tehran')::date AS day, sum(count) AS count
        FROM public.support_error_counters WHERE hour >= :'start'::timestamptz
            AND hour < :'as_of'::timestamptz GROUP BY 1 ORDER BY 1
    ) t)
);"""
RECORDS_SQL = "SELECT row_to_json(t) FROM public.support_record_counts() t;"
INVENTORY_CAPABILITIES_SQL = """SELECT coalesce(json_object_agg(tablename,true),'{}'::json)
    FROM pg_catalog.pg_tables WHERE schemaname='public';"""


def period(days: int, now: datetime | None = None):
    if type(days) is not int or days not in (7, 30, 90):
        raise ManagementError("INVALID_PERIOD", "بازهٔ آمار باید ۷، ۳۰ یا ۹۰ روز باشد.", 422)
    now = now or datetime.now(UTC)
    start = datetime.combine(
        now.astimezone(TEHRAN).date() - timedelta(days=days - 1), time.min, TEHRAN
    )
    return start, now


def validate_report(data: dict) -> dict:
    try:
        return ProductReport.model_validate_json(json.dumps(data)).model_dump(mode="json")
    except (ValueError, ValidationError) as exc:
        raise ManagementError(
            "ANALYTICS_INVALID", "ساختار گزارش آماری معتبر نیست؛ داده‌ای نمایش داده نشد.", 503
        ) from exc


def read_analytics(sql: Callable, days: int, now: datetime | None = None) -> dict:
    start, now = period(days, now)
    parameters = {"start": start.isoformat(), "as_of": now.isoformat()}

    def query(statement):
        # Each connection is read-only and bounded, including SECURITY DEFINER counts.
        return json.loads(
            sql(
                "BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='10s';\n"
                + statement
                + "\nCOMMIT;",
                parameters,
            )
        )

    capabilities = query(CAPABILITIES_SQL)
    base = query(SNAPSHOT_SQL)
    usage = query(USAGE_SQL) if capabilities["usage"] else None
    errors = query(ERRORS_SQL) if capabilities["errors"] else None
    records = query(RECORDS_SQL) if capabilities["records"] else None
    tables = query(INVENTORY_CAPABILITIES_SQL)
    # Only fixed identifiers/queries above can enter the generated aggregate query.
    fields = []
    for key, (table, statement) in INVENTORY_QUERIES.items():
        expression = "(" + statement + ")" if tables.get(table) is True else "NULL::bigint"
        fields.append("'" + key + "'," + expression)
    inventory = query("SELECT json_build_object(" + ",".join(fields) + ");")
    families = {row["day"]: row["count"] for row in base["families_daily"]}
    registrations = {row["day"]: row["count"] for row in base["registrations_daily"]}
    usage_days = {row["day"]: row for row in usage["daily"]} if usage else {}
    error_days = {row["day"]: row["count"] for row in errors["daily"]} if errors else {}
    modules = None
    totals = None
    if usage is not None:
        found = {row["module"]: ModuleCounts.model_validate(row) for row in usage["modules"]}
        modules = [
            found.get(module, ModuleCounts(module=module)).model_dump() for module in MODULES
        ]
        totals = {
            "opens": sum(row["opens"] for row in modules),
            "requests": sum(
                row[key]
                for row in modules
                for key in ("creates", "updates", "completes", "deletes")
            ),
        }
    daily = []
    for index in range(days):
        day = (start.date() + timedelta(days=index)).isoformat()
        daily.append(
            {
                "day": day,
                "families_created": families.get(day, 0),
                "registrations_completed": registrations.get(day, 0),
                "opens": usage_days.get(day, {}).get("opens", 0) if usage is not None else None,
                "requests": usage_days.get(day, {}).get("requests", 0)
                if usage is not None
                else None,
                "errors": error_days.get(day, 0) if errors is not None else None,
            }
        )
    return validate_report(
        {
            "days": days,
            "start_at": start.isoformat(),
            "checked_at": now.isoformat(),
            "snapshot": base["snapshot"],
            "daily": daily,
            "modules": modules,
            "usage": totals,
            "lifetime_usage": usage["lifetime"] if usage else None,
            "errors": errors["totals"] if errors else None,
            "records": records,
            "record_inventory": inventory,
            "measurement": {
                "usage_available": capabilities["usage"],
                "errors_available": capabilities["errors"],
                "records_available": capabilities["records"],
                "first_usage_counter": usage["since"] if usage else None,
                "first_error_counter": errors["since"] if errors else None,
            },
        }
    )


def demo_analytics(users: list[dict], days: int, now: datetime | None = None):
    start, now = period(days, now)
    registered = len(users)
    active = sum(row["state"] == "active" for row in users)
    pending = sum(row["state"] == "pending" for row in users)
    created = [datetime.fromisoformat(row["created_at"]) for row in users]
    logins = [datetime.fromisoformat(row["last_login"]) for row in users if row["last_login"]]
    first = min(created).astimezone(TEHRAN).date() if created else None
    observed = {module: ModuleCounts(module=module) for module in MODULES}
    lifetime = {"opens": 0, "requests": 0}
    daily = []
    errors = {"login": 0, "registration": 0, "server": 0, "total": 0}
    for index in range(90):
        day = now.astimezone(TEHRAN).date() - timedelta(days=89 - index)
        opens = requests = failures = 0
        if first is not None and day >= first:
            for offset, module in enumerate(
                (
                    "shopping",
                    "tasks",
                    "inventory",
                    "transactions",
                    "calendar",
                    "reports",
                    "accounts",
                    "settings",
                )
            ):
                count = (day.toordinal() + offset) % 9 + 1
                operation = 0 if module in {"reports", "calendar"} else count // 2
                opens += count
                requests += operation
                lifetime["opens"] += count
                lifetime["requests"] += operation
                if day >= start.date():
                    observed[module].opens += count
                    observed[module].creates += operation
            failures = int(day.toordinal() % 3 == 0)
        if day < start.date():
            continue
        errors["login"] += failures
        errors["total"] += failures
        daily.append(
            {
                "day": day.isoformat(),
                "families_created": int(first == day),
                "registrations_completed": sum(
                    value.astimezone(TEHRAN).date() == day for value in created
                ),
                "opens": opens,
                "requests": requests,
                "errors": failures,
            }
        )
    accounts_with_login = sum(start <= value < now for value in logins)
    modules = [row.model_dump() for row in observed.values()]
    return validate_report(
        {
            "days": days,
            "start_at": start.isoformat(),
            "checked_at": now.isoformat(),
            "snapshot": {
                "families": int(bool(users)),
                "families_with_accounts": int(bool(users)),
                "profiles": registered,
                "registered_accounts": registered,
                "introduced_profiles": 0,
                "managed_profiles": 0,
                "active_accounts": active,
                "pending_accounts": pending,
                "inactive_accounts": registered - active - pending,
                "accounts_with_login": accounts_with_login,
                "families_with_login": int(accounts_with_login > 0),
                "accounts_without_login_history": registered - len(logins),
                "accounts_without_registration_history": 0,
            },
            "daily": daily,
            "modules": modules,
            "usage": {
                "opens": sum(row["opens"] for row in modules),
                "requests": sum(row["creates"] for row in modules),
            },
            "lifetime_usage": lifetime,
            "errors": errors,
            "records": {
                "transactions": 24 if users else 0,
                "scheduled_plans": 3 if users else 0,
                "open_tasks": 7 if users else 0,
                "completed_tasks": 18 if users else 0,
                "shopping_lists": 4 if users else 0,
                "documents": 2 if users else 0,
            },
            "record_inventory": dict(
                zip(
                    INVENTORY_QUERIES,
                    (
                        value if users else 0
                        for value in (3, 6, 8, 22, 17, 12, 7, 4, 1, 3, 9, 2, 1, 18)
                    ),
                    strict=True,
                )
            ),
            "measurement": {
                "usage_available": True,
                "errors_available": True,
                "records_available": True,
                "first_usage_counter": min(created).isoformat() if created else None,
                "first_error_counter": min(created).isoformat() if users else None,
            },
        }
    )
