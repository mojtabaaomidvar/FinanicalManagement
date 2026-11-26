"""Finite, host-owned feature access policy shared by API and management."""

import hashlib
import hmac
import json

AI_ENV_DEFAULTS = {
    "AI_CONNECTION_MODE": "auto", "AI_SMS_MODEL": "deepseek-flash",
    "AI_SMS_TIMEOUT_SECONDS": "25", "AI_MAX_OUTPUT_TOKENS": "1800",
    "AI_REQUESTS_PER_DAY": "0", "AI_FAMILY_REQUESTS_PER_DAY": "0", "AI_MAX_CONCURRENT": "0",
    "DEEPSEEK_API_KEY": "", "AI_SMS_GATEWAY_URL": "", "AI_SMS_GATEWAY_TOKEN": "",
}


def ai_configuration_revision(values: dict[str, str], secret: str) -> str:
    """A keyed acknowledgement of loaded configuration; no values or keys leave the API."""
    if not secret:
        return ""
    projection = {
        key: str(values.get(key, default)).strip() for key, default in AI_ENV_DEFAULTS.items()
    }
    try:
        projection["AI_SMS_TIMEOUT_SECONDS"] = str(float(projection["AI_SMS_TIMEOUT_SECONDS"]))
        for key in (
            "AI_MAX_OUTPUT_TOKENS", "AI_REQUESTS_PER_DAY",
            "AI_FAMILY_REQUESTS_PER_DAY", "AI_MAX_CONCURRENT",
        ):
            projection[key] = str(int(projection[key]))
    except ValueError:
        return ""
    return hmac.new(
        secret.encode(), json.dumps(projection, sort_keys=True).encode(), hashlib.sha256,
    ).hexdigest()

FEATURES = (
    "transactions", "accounts", "budgets", "bills", "calendar", "shopping", "inventory",
    "tasks", "documents", "meals", "equipment", "vehicles", "goals", "activities",
    "children", "pets", "market", "assistant",
)
FEATURE_KEYS = frozenset("feature_" + name for name in FEATURES)
FEATURE_STATES = frozenset({"enabled", "read_only", "disabled"})
RESOURCE_FEATURE = {
    "transactions": "transactions", "accounts": "accounts", "category-budgets": "budgets",
    "bills": "bills", "events": "calendar", "shopping": "shopping", "inventory": "inventory",
    "tasks": "tasks", "documents": "documents", "meals": "meals", "equipment": "equipment",
    "vehicles": "vehicles", "goals": "goals", "activities": "activities", "children": "children",
    "pets": "pets", "holdings": "market", "market": "market", "assistant": "assistant",
}


def feature_state(module: str, flags: dict | None = None) -> str:
    if flags is None:
        from app.core.managed_runtime import read_flags

        flags = read_flags()
    return flags.get("feature_" + module, "enabled")


def require_feature(module: str, *, write: bool = False, flags: dict | None = None) -> None:
    from app.core.errors import AppError

    state = feature_state(module, flags)
    if state == "disabled":
        raise AppError(
            "FEATURE_DISABLED",
            "این بخش موقتاً توسط مدیر سامانه غیرفعال شده است؛ اطلاعات قبلی حفظ می‌شود.", 503,
        )
    if state == "read_only" and write:
        raise AppError(
            "FEATURE_READ_ONLY",
            "این بخش موقتاً فقط‌خواندنی است؛ تغییر شما هنوز روی سرور اعمال نشده است.", 503,
        )
