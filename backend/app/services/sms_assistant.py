"""DeepSeek-backed SMS extraction; account matching and persistence stay local."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.account import Account
from app.models.family import Member
from app.models.messaging import SmsMessage
from app.schemas.sms_assistant import SmsAssistantImportIn
from app.services.bank_catalog import ALIASES, BANKS
from app.services.financial_text import amount_unit, normalize_financial_text
from app.services.financial_text import source_amounts as financial_source_amounts
from app.services.sms_ai_protocol import EXPENSE_CATEGORIES as _EXPENSE_CATEGORIES
from app.services.sms_ai_protocol import INCOME_CATEGORIES as _INCOME_CATEGORIES
from app.services.sms_ai_protocol import build_messages
from app.services.sms_ai_provider import ERRORS, provider_error, request_deepseek
from app.services.sms_ai_provider import OUTPUT_FAILED as _OUTPUT_FAILED
from app.services.sms_parser import detect_bank, normalize_sms, parse_sms, to_en


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", to_en(value or ""))


def _identifier_pattern(value: str) -> re.Pattern[str]:
    digits = _digits(value)
    return re.compile(r"(?<!\d)" + r"[\s\-]*".join(map(re.escape, digits)) + r"(?!\d)")


def _owned_bank_accounts(db: Session, actor: Member) -> list[Account]:
    return list(db.scalars(select(Account).where(
        Account.family_id == actor.family_id,
        Account.member_id == actor.id,
        Account.kind == "bank",
    ).order_by(Account.created_at.asc())))


def _owned_accounts(db: Session, actor: Member) -> list[Account]:
    return list(db.scalars(select(Account).where(
        Account.family_id == actor.family_id,
        Account.member_id == actor.id,
    ).order_by(Account.created_at.asc())))


def _account_identifiers(account: Account) -> list[tuple[str, str]]:
    return [
        (kind, value)
        for kind, value in (
            ("card", account.card_number),
            ("account_number", getattr(account, "account_number", None)),
            ("iban", getattr(account, "iban", None)),
        )
        if value and _digits(value)
    ]


def _mask_text(raw: str, accounts: list[Account]) -> tuple[str, dict[str, Account], list[Account]]:
    """Mask known identifiers before sending text to the provider; aliases are request-local."""
    original = normalize_sms(raw)
    text = original
    aliases: dict[str, Account] = {}
    exact_hits: list[Account] = []
    alias_by_account: dict[uuid.UUID, str] = {}
    matched_identifiers: dict[str, list[tuple[Account, str]]] = {}
    for account in accounts:
        for kind, identifier in _account_identifiers(account):
            pattern = _identifier_pattern(identifier)
            if pattern.search(original):
                exact_hits.append(account)
                matched_identifiers.setdefault(_digits(identifier), []).append((account, kind))
    for identifier, matches in matched_identifiers.items():
        owners = {account.id: account for account, _kind in matches}
        pattern = _identifier_pattern(identifier)
        if len(owners) != 1:
            text = pattern.sub("[شناسهٔ بانکی مبهم]", text)
            continue
        account = next(iter(owners.values()))
        alias = alias_by_account.get(account.id)
        if alias is None:
            alias = f"A{len(alias_by_account) + 1}"
            alias_by_account[account.id] = alias
            aliases[alias] = account
        text = pattern.sub(f"[[ACCOUNT_{alias}]]", text)
    # Mask account-like strings even when the user has not saved them in their profile.
    text = re.sub(
        r"(?i)((?:شماره\s*)?(?:کارت|حساب|شبا)\s*[:：]?\s*)(?:IR\s*)?[\d*xX\- ]{6,32}",
        r"\1[شناسهٔ بانکی]",
        text,
    )
    text = re.sub(r"(?<!\d)09\d{9}(?!\d)", "[شمارهٔ موبایل]", text)
    text = re.sub(r"(?<!\d)\d{16}(?!\d)", "[شمارهٔ کارت]", text)
    text = re.sub(r"(?i)IR\s*\d{24}", "[شمارهٔ شبا]", text)
    return text, aliases, list(dict.fromkeys(exact_hits))


def _model_request(messages: list[dict[str, str]]) -> dict:
    return request_deepseek(
        messages, api_key=settings.deepseek_api_key,
        model=settings.ai_sms_model, timeout=settings.ai_sms_timeout_seconds,
    )


def _gateway_request(items: list[dict]) -> dict:
    url = settings.ai_sms_gateway_url.strip().rstrip("/")
    token = settings.ai_sms_gateway_token.strip()
    try:
        parsed = urlsplit(url)
        _ = parsed.port
        local_test = (
            settings.app_env in {"test", "local-sandbox", "development"}
            and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        )
        if (
            not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token)
            or not parsed.hostname or (parsed.scheme != "https" and not local_test)
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment
        ):
            raise ValueError("Invalid private gateway configuration")
    except ValueError:
        raise provider_error("AI_GATEWAY_NOT_CONFIGURED") from None
    try:
        response = httpx.post(
            url + "/v1/sms/analyze",
            headers={"Authorization": f"Bearer {token}"},
            json={"items": items},
            timeout=settings.ai_sms_timeout_seconds + 5,
            follow_redirects=False,
        )
        if response.status_code in {401, 403}:
            raise provider_error("AI_GATEWAY_AUTH_FAILED")
        if response.is_error:
            try:
                code = response.json().get("error")
            except (ValueError, AttributeError):
                code = None
            if isinstance(code, str) and code in ERRORS:
                raise provider_error(code)
            raise provider_error("AI_GATEWAY_UNAVAILABLE")
        if response.is_redirect:
            raise provider_error("AI_GATEWAY_UNAVAILABLE")
        return json.loads(response.text, parse_float=Decimal, parse_int=Decimal)
    except httpx.TimeoutException:
        raise provider_error("AI_PROVIDER_TIMEOUT") from None
    except httpx.HTTPError:
        raise provider_error("AI_GATEWAY_UNAVAILABLE") from None
    except (ValueError, TypeError, AttributeError):
        raise provider_error("AI_INVALID_RESULT") from None


def _allowed_category(value: object, transaction_type: str) -> str | None:
    if not isinstance(value, str):
        return None
    allowed = _EXPENSE_CATEGORIES if transaction_type == "expense" else _INCOME_CATEGORIES
    return value if value in allowed else None


def _valid_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _amount(value: object) -> Decimal | None:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return amount if amount.is_finite() and Decimal(0) < amount <= Decimal("999999999999") else None


def _unit(value: object, raw_text: str) -> str | None:
    units = set(re.findall(r"ریال|تومان", normalize_sms(raw_text)))
    explicit = "rial" if units == {"ریال"} else "toman" if units == {"تومان"} else None
    return str(value) if value in ("rial", "toman") and value == explicit else explicit


def _suggest_account(
    text: str,
    bank: str | None,
    alias: object,
    aliases: dict[str, Account],
    exact_hits: list[Account],
    accounts: list[Account],
) -> tuple[Account | None, str | None, float]:
    if isinstance(alias, str) and alias in aliases and f"[[ACCOUNT_{alias}]]" in text:
        account = aliases[alias]
        matched_kind = next(
            (kind for kind, _identifier in _account_identifiers(account)), "card"
        )
        return account, matched_kind, 0.99
    unique_hits = list({account.id: account for account in exact_hits}.values())
    if len(unique_hits) == 1:
        account = unique_hits[0]
        matched_kind = next(
            (
                kind
                for kind, identifier in _account_identifiers(account)
                if _identifier_pattern(identifier).search(normalize_sms(text))
            ),
            "card",
        )
        return account, matched_kind, 0.96
    local = parse_sms(text)
    detected_bank = bank or (local.bank if local else None) or detect_bank(text)
    if detected_bank:
        matching_bank = [
            a for a in accounts
            if a.bank and _normalize_bank(a.bank) == _normalize_bank(detected_bank)
        ]
        if len(matching_bank) == 1:
            return matching_bank[0], "unique_bank", 0.56
    # A masked last-four match is only a suggestion and always remains user-reviewable.
    suffixes = re.findall(r"(?:\*{2,}|x{2,}|…{1,})[\s-]*(\d{4})", to_en(text), re.I)
    if suffixes and detected_bank:
        matching_suffix = [
            a for a in accounts
            if a.bank and _normalize_bank(a.bank) == _normalize_bank(detected_bank)
            and _digits(a.card_number).endswith(suffixes[-1])
        ]
        if len(matching_suffix) == 1:
            return matching_suffix[0], "card_tail", 0.78
    return None, None, 0.0


def _normalize_bank(value: str | None) -> str:
    text = normalize_sms(value or "").replace("بانک", "").replace("موسسه", "").replace("مؤسسه", "")
    compact = " ".join(text.split())
    for entry in BANKS:
        bank_id = entry["id"]
        names = [entry["name_fa"], bank_id]
        names.extend(name for name, alias_id in ALIASES.items() if alias_id == bank_id)
        normalized_names = {
            " ".join(normalize_sms(name).replace("بانک", "").split())
            for name in names
        }
        if compact in normalized_names:
            return bank_id
    return compact


def analyze(db: Session, actor: Member, items: list) -> dict:
    if not settings.ai_sms_gateway_url.strip() and not settings.deepseek_api_key.strip():
        raise provider_error("AI_NOT_CONFIGURED")
    accounts = _owned_bank_accounts(db, actor)
    masked_items: list[dict[str, object]] = []
    local_maps: list[tuple[str, dict[str, Account], list[Account]]] = []
    for index, item in enumerate(items):
        masked, aliases, exact_hits = _mask_text(item.raw_text, accounts)
        masked = normalize_financial_text(masked)
        local_maps.append((masked, aliases, exact_hits))
        masked_items.append({
            "source_index": index,
            "text": masked,
            "account_aliases": [
                {"alias": key, "bank": value.bank}
                for key, value in aliases.items()
            ],
        })
    payload = (
        _gateway_request(masked_items) if settings.ai_sms_gateway_url.strip()
        else _model_request(build_messages(masked_items))
    )
    raw_events = payload.get("transactions") if isinstance(payload, dict) else None
    if not isinstance(raw_events, list) or len(raw_events) > 80:
        raise AppError("AI_INVALID_RESULT", _OUTPUT_FAILED, 502)
    parsed_events: list[dict] = []
    source_event_counts: dict[int, int] = {}
    for raw_event in raw_events:
        if not isinstance(raw_event, dict):
            continue
        try:
            raw_index = int(raw_event.get("source_index"))
        except (ValueError, TypeError):
            continue
        if 0 <= raw_index < len(items) and raw_event.get("type") in ("expense", "income"):
            source_event_counts[raw_index] = source_event_counts.get(raw_index, 0) + 1
    for event in raw_events:
        if not isinstance(event, dict):
            continue
        try:
            source_index = int(event.get("source_index"))
        except (ValueError, TypeError):
            continue
        if not 0 <= source_index < len(items):
            continue
        transaction_type = event.get("type")
        if transaction_type not in ("expense", "income"):
            parsed_source = parse_sms(items[source_index].raw_text)
            transaction_type = parsed_source.type if parsed_source else None
        if transaction_type not in ("expense", "income"):
            continue
        amount = _amount(event.get("amount"))
        source_text = items[source_index].raw_text
        masked, aliases, exact_hits = local_maps[source_index]
        parsed_source = parse_sms(masked)
        source_amounts = financial_source_amounts(masked)
        if parsed_source and parsed_source.balance is not None:
            source_amounts.discard(Decimal(parsed_source.balance))
        if amount not in source_amounts:
            amount = None
        if (amount is None and source_event_counts.get(source_index) == 1
                and parsed_source and parsed_source.type == transaction_type):
            local_amount = _amount(parsed_source.amount)
            amount = local_amount if local_amount in source_amounts else None
        unit = amount_unit(masked, amount)
        if unit is None and source_event_counts.get(source_index, 0) <= 1:
            unit = _unit(event.get("unit"), source_text)
        model_bank = event.get("bank") if isinstance(event.get("bank"), str) else None
        trusted_bank = (parsed_source.bank if parsed_source else None) or detect_bank(source_text)
        bank = trusted_bank or model_bank
        account, match_kind, match_confidence = _suggest_account(
            masked,
            trusted_bank,
            event.get("account_alias"),
            aliases,
            exact_hits,
            accounts,
        )
        confidence = event.get("confidence")
        try:
            confidence = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError, OverflowError):
            confidence = 0.0
        parsed_events.append({
            "source_index": source_index,
            "raw_text": source_text,
            "type": transaction_type,
            "amount": amount,
            "amount_unit": unit,
            "bank": bank,
            "date": _valid_date(event.get("date")) or (
                parsed_source.date if parsed_source else None
            ),
            "category": _allowed_category(event.get("category"), transaction_type)
                or ("other-e" if transaction_type == "expense" else "other-i"),
            "account_id": str(account.id) if account and match_confidence >= 0.9 else None,
            "account_title": account.title if account else None,
            "account_match": match_kind,
            "confidence": confidence,
            "match_confidence": match_confidence,
        })
    if not parsed_events and raw_events:
        raise AppError("AI_INVALID_RESULT", _OUTPUT_FAILED, 502)
    counts: dict[int, int] = {}
    for event in parsed_events:
        counts[event["source_index"]] = counts.get(event["source_index"], 0) + 1
    if any(total > 10 for total in counts.values()):
        # @copy-text sms.assistant.invalid_result
        raise AppError("AI_INVALID_RESULT", _OUTPUT_FAILED, 502)
    seen: dict[int, int] = {}
    candidates = []
    for event in parsed_events:
        source_index = event["source_index"]
        candidate_index = seen.get(source_index, 0)
        seen[source_index] = candidate_index + 1
        candidates.append({
            **event,
            "event_id": str(uuid.uuid4()),
            "candidate_index": candidate_index,
            "candidate_total": counts[source_index],
            "confidence": event["confidence"],
        })
    return {"candidates": candidates}


def import_suggestions(db: Session, actor: Member, body: SmsAssistantImportIn) -> list[SmsMessage]:
    accounts = {str(a.id): a for a in _owned_accounts(db, actor)}
    rows: list[dict] = []
    for candidate in body.candidates:
        account = None
        if candidate.account_id:
            account = accounts.get(candidate.account_id)
            if account is None:
                raise AppError("ACCOUNT_FORBIDDEN", "فقط حساب بانکی خودتان قابل انتخاب است.", 403)
        category = _allowed_category(candidate.category, candidate.type)
        rows.append({
            "family_id": actor.family_id,
            "member_id": actor.id,
            "raw_text": candidate.raw_text,
            "bank": candidate.bank,
            "type": candidate.type,
            "amount": candidate.amount,
            "amount_unit": candidate.amount_unit,
            "balance": None,
            "date": candidate.date,
            "status": "pending",
            "account_id": account.id if account else None,
            "suggested_category": category,
            "ai_import_key": body.operation_id,
            "ai_source_index": candidate.source_index,
            "ai_candidate_index": candidate.candidate_index,
            "ai_candidate_total": candidate.candidate_total,
        })
    stmt = insert(SmsMessage).values(rows).on_conflict_do_nothing(
        index_elements=["ai_import_key", "ai_source_index", "ai_candidate_index"],
    )
    db.execute(stmt)
    db.commit()
    imported = list(db.scalars(select(SmsMessage).where(
        SmsMessage.family_id == actor.family_id,
        SmsMessage.member_id == actor.id,
        SmsMessage.ai_import_key == body.operation_id,
    ).order_by(SmsMessage.ai_source_index.asc(), SmsMessage.ai_candidate_index.asc())))
    expected = {
        (candidate.source_index, candidate.candidate_index): candidate
        for candidate in body.candidates
    }
    if len(imported) != len(body.candidates) or any(
        (row.ai_source_index, row.ai_candidate_index) not in expected
        or row.raw_text != expected[(row.ai_source_index, row.ai_candidate_index)].raw_text
        or row.type != expected[(row.ai_source_index, row.ai_candidate_index)].type
        or row.amount != expected[(row.ai_source_index, row.ai_candidate_index)].amount
        or row.amount_unit != expected[(row.ai_source_index, row.ai_candidate_index)].amount_unit
        or row.date != expected[(row.ai_source_index, row.ai_candidate_index)].date
        or row.account_id != (
            uuid.UUID(expected[(row.ai_source_index, row.ai_candidate_index)].account_id)
            if expected[(row.ai_source_index, row.ai_candidate_index)].account_id else None
        )
        or row.suggested_category != _allowed_category(
            expected[(row.ai_source_index, row.ai_candidate_index)].category,
            expected[(row.ai_source_index, row.ai_candidate_index)].type,
        )
        for row in imported
    ):
        raise AppError("AI_IMPORT_CONFLICT", "این پیشنهادها قبلاً با نتیجهٔ دیگری ثبت شده‌اند.", 409)
    return imported
