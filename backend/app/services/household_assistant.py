"""Local permission, evidence, money and date grounding; analysis never writes."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.core.errors import AppError
from app.services import sms_assistant
from app.services.ai_controls import connection_mode, family_calls
from app.services.financial_text import normalize_financial_text
from app.services.household_ai_protocol import (
    KINDS,
    SCOPE_KINDS,
    FinancialProposal,
    GatewayHouseholdIn,
    HouseholdResult,
    ShoppingProposal,
    TaskProposal,
    build_household_messages,
)
from app.services.jalali import to_jalali
from app.services.member_age import today_tehran
from app.services.sms_ai_provider import (
    ERRORS,
    ai_attempt_started,
    capture_gateway_usage,
    provider_error,
    request_deepseek_json,
)
from app.services.sms_parser import extract_date, normalize_sms
from app.services.usage import measure_ai

# @copy-text assistant.invalid_result
INVALID_RESULT = "نتیجهٔ دستیار قابل‌استفاده نبود؛ متن را بررسی و دوباره تلاش کنید."
# @copy-text assistant.connection_failed
CONNECTION_FAILED = "ارتباط با دستیار برقرار نشد؛ متن شما باقی مانده است. دوباره تلاش کنید."
# @copy-text assistant.upgrade_required
UPGRADE_REQUIRED = "برای آماده‌کردن خرید و کارهای خانه، درگاه دستیار باید به‌روز شود."


def _base_url() -> str:
    url = settings.ai_sms_gateway_url.strip().rstrip("/")
    parsed = urlsplit(url)
    try:
        _ = parsed.port
    except ValueError:
        raise AppError("AI_GATEWAY_NOT_CONFIGURED", CONNECTION_FAILED, 503) from None
    local = (settings.app_env in {"test", "local-sandbox", "development"}
             and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"})
    if (not parsed.hostname or parsed.scheme != "https" and not local or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", settings.ai_sms_gateway_token.strip())):
        raise AppError("AI_GATEWAY_NOT_CONFIGURED", CONNECTION_FAILED, 503)
    return url


def _gateway_request(path: str, body: dict | None = None) -> dict:
    url = _base_url() + path
    try:
        if body is not None:
            ai_attempt_started()
        response = httpx.request(
            "GET" if body is None else "POST", url,
            headers={"Authorization": "Bearer " + settings.ai_sms_gateway_token.strip()},
            **({"json": body} if body is not None else {}),
            timeout=5 if body is None else settings.ai_sms_timeout_seconds + 5,
            follow_redirects=False,
        )
        if body is not None:
            capture_gateway_usage(response.headers)
        if response.status_code == 404:
            raise AppError("AI_ASSISTANT_UPGRADE_REQUIRED", UPGRADE_REQUIRED, 503)
        if response.status_code in {401, 403}:
            raise AppError("AI_GATEWAY_AUTH_FAILED",
                           provider_error("AI_GATEWAY_AUTH_FAILED").message, 503)
        if response.is_error:
            try:
                failure = response.json()
            except ValueError:
                failure = None
            code = failure.get("error") if isinstance(failure, dict) else None
            if isinstance(code, str) and code in ERRORS:
                raise provider_error(code)
        if response.is_error or response.is_redirect:
            raise AppError("AI_GATEWAY_UNAVAILABLE", CONNECTION_FAILED, 503)
        return json.loads(response.text, parse_float=Decimal)
    except (httpx.HTTPError, ValueError, TypeError):
        raise AppError("AI_GATEWAY_UNAVAILABLE", CONNECTION_FAILED, 503) from None


def capabilities() -> dict:
    if settings.ai_connection_mode == "disabled":
        return {"status": "unavailable", "protocol_version": None, "kinds": []}
    if connection_mode() == "gateway":
        try:
            result = _gateway_request("/v1/assistant/capabilities")
            if (not isinstance(result, dict) or type(result.get("protocol_version")) is not int
                    or result.get("protocol_version") != 2 or result.get("kinds") != KINDS
                    or result.get("contextual") is not True or result.get("max_inferences") != 2
                    or result.get("status") != "ready"):
                return {"status": "upgrade_required", "protocol_version": None, "kinds": []}
        except AppError as error:
            status = "unavailable"
            if error.code == "AI_ASSISTANT_UPGRADE_REQUIRED":
                status = "upgrade_required"
            elif error.code in {"AI_GATEWAY_AUTH_FAILED", "AI_GATEWAY_NOT_CONFIGURED"}:
                status = "misconfigured"
            return {"status": status, "protocol_version": None, "kinds": []}
    elif not settings.deepseek_api_key.strip():
        return {"status": "misconfigured", "protocol_version": None, "kinds": []}
    return {"status": "ready", "protocol_version": 2, "kinds": KINDS,
            "contextual": True, "max_inferences": 2}


def resolve_day(text: str, reference: date, *, future: bool = False) -> tuple[date | None, bool]:
    text = normalize_sms(text)
    relative = {"امروز": 0, "دیروز": -1, "پریروز": -2}
    if future:
        relative.update({"فردا": 1, "پس فردا": 2, "پسفردا": 2})
    markers = list(re.finditer(r"پریروز|دیروز|امروز|پس[ ‌]?فردا|فردا", text))
    explicit = re.findall(
        r"(?:1[34]\d{2}|20\d{2})[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]20\d{2}", text,
    )
    if len(markers) + len(explicit) > 1:
        return None, True
    if markers:
        offset = relative.get(markers[0][0])
        return (reference + timedelta(days=offset), False) if offset is not None else (None, True)
    if explicit:
        try:
            parsed = extract_date(explicit[0])
            if parsed:
                candidate = date(parsed.gy, parsed.gm, parsed.gd)
                if to_jalali(candidate.year, candidate.month, candidate.day) == parsed.jalali:
                    return candidate, False
        except ValueError:
            pass
        return None, True
    weekdays = {"دوشنبه": 0, "سه شنبه": 1, "سهشنبه": 1, "چهارشنبه": 2,
                "پنج شنبه": 3, "پنجشنبه": 3, "جمعه": 4, "شنبه": 5, "یکشنبه": 6}
    found = [match[0] for match in re.finditer(
        r"(?<!\w)(?:دوشنبه|سه ?شنبه|چهارشنبه|پنج ?شنبه|جمعه|یکشنبه|شنبه)(?!\w)", text)]
    if future and len(found) == 1:
        return reference + timedelta(days=(weekdays[found[0]] - reference.weekday()) % 7), True
    return None, bool(found)


def _quantity(value: Decimal | None, evidence: str) -> Decimal | None:
    if value is None:
        return None
    from app.services.financial_text import _value
    tokens = re.findall(r"\d+(?:[.٫]\d+)?|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده", evidence)
    return value if any(_value(token) == value for token in tokens) else None


def require_nonfinancial_registration(text: str, scope: str = "auto") -> None:
    financial = bool(re.search(r"تراکنش|واریز|برداشت|پرداخت|خرج|درآمد|حقوق|تومان|ریال|کرایه|دادم|بانک|transaction|deposit|withdraw|payment|paid|income|expense|rial|toman", text, re.I))
    other_request = bool(re.search(r"لیست|اضافه کن|یادآور|نظافت|صبحانه|صبحونه|ناهار|شام|موجودی مواد|وظیفه|کارها", text))
    if scope == "finance" or scope == "auto" and financial and not other_request:
        raise AppError("AI_FINANCE_DISABLED", "دستیار در ثبت تراکنش مالی نقشی ندارد؛ از بخش تراکنش‌ها استفاده کنید.", 422)


@family_calls
def analyze(db, actor, text: str, scope: str) -> dict:
    require_nonfinancial_registration(text, scope)
    if not text.strip():
        # @copy-text assistant.text_required
        raise AppError("AI_EMPTY_TEXT", "متن درخواست را بنویسید.", 422)
    reference = today_tehran()
    accounts = sms_assistant._owned_bank_accounts(db, actor)
    masked, aliases, exact_hits = sms_assistant._mask_text(text, accounts)
    masked = normalize_financial_text(masked)
    body = GatewayHouseholdIn(text=masked, scope=scope, account_aliases=list(aliases))
    with measure_ai("assistant_analyze"):
        if connection_mode() == "gateway":
            payload = _gateway_request("/v1/assistant/analyze", body.model_dump())
        elif settings.deepseek_api_key.strip():
            try:
                payload = request_deepseek_json(
                    build_household_messages(body), api_key=settings.deepseek_api_key,
                    model=settings.ai_sms_model, timeout=settings.ai_sms_timeout_seconds,
                    max_output_tokens=settings.ai_max_output_tokens,
                )
            except AppError as error:
                raise AppError(error.code, CONNECTION_FAILED, error.http_status) from None
        else:
            raise AppError("AI_GATEWAY_NOT_CONFIGURED", CONNECTION_FAILED, 503)
        return ground_result(payload, masked, aliases, exact_hits, accounts, reference, scope)


def ground_result(payload, masked, aliases, exact_hits, accounts, reference, scope="auto"):
    """Shared evidence checks; contextual reporting must never repeat inference to ground money."""
    try:
        result = HouseholdResult.model_validate(payload)
    except ValidationError:
        raise AppError("AI_INVALID_RESULT", INVALID_RESULT, 502) from None
    proposals, unsupported = [], []
    seen = set()
    for item in [*result.proposals, *result.unsupported]:
        if item.source_text not in masked:
            raise AppError("AI_INVALID_RESULT", INVALID_RESULT, 502)
    unsupported.extend(item.model_dump() for item in result.unsupported)
    for item in result.proposals:
        evidence = item.source_text
        if scope != "auto" and item.kind != SCOPE_KINDS[scope]:
            unsupported.append({"source_text": evidence, "reason": "scope_mismatch"})
            continue
        signature = json.dumps(item.model_dump(), ensure_ascii=False, default=str, sort_keys=True)
        if signature in seen:
            continue
        seen.add(signature)
        row = item.model_dump()
        row.update(id=str(uuid.uuid4()), warnings=[])
        ambiguous = masked.count(evidence) != 1
        if isinstance(item, FinancialProposal):
            unsupported.append({"source_text": evidence, "reason": "unsupported_action"})
            continue
        elif isinstance(item, ShoppingProposal):
            row["qty"] = _quantity(item.qty, evidence) if not ambiguous else None
            row["unit"] = item.unit if item.unit and item.unit in evidence else None
            if item.qty is not None and row["qty"] is None:
                row["warnings"].append("quantity")
        elif isinstance(item, TaskProposal):
            day, review = resolve_day(evidence, reference, future=True)
            row["due_date"] = day.isoformat() if day and not ambiguous else None
            if day is None or review or ambiguous:
                row["warnings"].append("date")
            if re.search(r"ساعت|هر روز|هر هفته|هر ماه", evidence):
                unsupported.append({"source_text": evidence, "reason": "unsupported_schedule"})
        proposals.append(row)
    return {"protocol_version": 1, "reference_date": reference.isoformat(),
            "proposals": proposals, "unsupported": unsupported}
