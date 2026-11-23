"""Two bounded inferences, local evidence and signed candidate actions. No analysis writes."""
from __future__ import annotations

import json
import re
import uuid

from pydantic import ValidationError

from app.core.config import settings
from app.core.errors import AppError
from app.services import household_assistant as legacy
from app.services import sms_assistant
from app.services.financial_text import normalize_financial_text
from app.services.household_ai_protocol import (
    ContextPlan,
    ContextPlanIn,
    ContextReport,
    ContextReportIn,
    build_context_messages,
)
from app.services.household_context import (
    build_facts,
    normalize_title,
    read_context,
    sanitize_text,
    stock_fingerprint,
)
from app.services.member_age import today_tehran
from app.services.sms_ai_provider import request_deepseek


def _infer(body, schema, path):
    if settings.ai_sms_gateway_url.strip():
        payload = legacy._gateway_request(path, body.model_dump())
    elif settings.deepseek_api_key.strip():
        payload = request_deepseek(
            build_context_messages(body), api_key=settings.deepseek_api_key,
            model=settings.ai_sms_model, timeout=settings.ai_sms_timeout_seconds,
        )
    else:
        raise AppError("AI_GATEWAY_NOT_CONFIGURED", legacy.CONNECTION_FAILED, 503)
    try:
        return schema.model_validate(payload)
    except ValidationError:
        raise AppError("AI_INVALID_RESULT", legacy.INVALID_RESULT, 502) from None


def _report_context(facts, actions, context):
    value = {"facts": facts, "actions": actions,
             "sections": [{key: item[key] for key in
                           ("section", "status", "reference_date")} for item in context]}
    encoded = json.dumps(value, ensure_ascii=False, default=str)
    if len(encoded.encode("utf-8")) > 96000:
        # Repeated stock matches and recipe rows can exceed the gateway's input
        # budget even when each authorized section is bounded. The second model
        # only groups existing IDs: send compact computed facts, never clip JSON
        # or omit the authoritative findings shown by the app.
        keys = {"id", "kind", "title", "section", "status", "dish_id",
                "conflicts_with_request"}
        value["facts"] = [{key: item for key, item in fact.items() if key in keys}
                          for fact in facts]
        value["detail_omitted_for_budget"] = True
        encoded = json.dumps(value, ensure_ascii=False, default=str)
    return encoded


def analyze(db, actor, text: str):
    if not text.strip():
        raise AppError("AI_EMPTY_TEXT", "متن درخواست را بنویسید.", 422)
    reference = today_tehran()
    accounts = sms_assistant._owned_bank_accounts(db, actor)
    masked, aliases, hits = sms_assistant._mask_text(text, accounts)
    masked = normalize_financial_text(sanitize_text(masked))
    plan = _infer(ContextPlanIn(text=masked, reference_date=reference.isoformat(),
                                account_aliases=list(aliases)), ContextPlan, "/v1/assistant/plan")
    if any(item.source_text not in masked for item in plan.proposals):
        raise AppError("AI_INVALID_RESULT", legacy.INVALID_RESULT, 502)
    terms = [term for term in plan.terms if normalize_title(term) in normalize_title(masked)
             or normalize_title(term) == "نان" and "نون" in masked]
    sections = list(dict.fromkeys(plan.sections))
    # Food requests cannot omit their source-of-truth inventory and shopping checks.
    food_request = bool(re.search(r"صبحونه|صبحانه|غذا|ناهار|شام", masked))
    if "meals" in sections or food_request:
        sections = list(dict.fromkeys([*sections, "meals", "inventory", "shopping"]))
    elif any(item.kind == "shopping_item" for item in plan.proposals):
        sections = list(dict.fromkeys([*sections, "inventory", "shopping"]))
    grounded = legacy.ground_result(
        {"proposals": [item.model_dump() for item in plan.proposals]},
        masked, aliases, hits, accounts, reference,
    )
    context = read_context(db, actor, sections, terms, reference)
    declared_missing = bool(re.search(r"نداریم|تمام شده|تموم شده|نیاز داریم", masked))
    facts = build_facts(context, terms, declared_missing=declared_missing)
    actions = []
    financial = []
    for proposal in grounded["proposals"]:
        if proposal["kind"] == "transaction":
            financial.append(proposal)
        else:
            actions.append({**proposal, "id": str(uuid.uuid4())})
    for fact in facts:
        if fact["kind"] != "dish":
            continue
        actions.append({"id": str(uuid.uuid4()), "kind": "meal_entry", "title": fact["title"],
                        "dish_id": fact["dish_id"], "source_fact": fact["id"],
                        "status": fact["status"], "reference_date": reference.isoformat()})
        for ingredient in fact["ingredients"]:
            if ingredient["status"] == "missing" and not any(
                action["kind"] == "shopping_item" and normalize_title(action["title"])
                == normalize_title(ingredient["title"]) for action in actions
            ):
                actions.append({"id": str(uuid.uuid4()), "kind": "shopping_item",
                                "title": ingredient["title"], "qty": ingredient["shortage"],
                                "unit": ingredient.get("unit"), "source_fact": fact["id"]})
    shopping = next((item for item in context if item["section"] == "shopping"), None)
    # A need explicitly stated in the message can be proposed without inventing a price.
    if shopping and declared_missing:
        for term in terms:
            if not any(action["kind"] == "shopping_item"
                       and normalize_title(action["title"]) == normalize_title(term)
                       for action in actions):
                actions.append({"id": str(uuid.uuid4()), "kind": "shopping_item", "title": term,
                                "qty": None, "unit": None, "source_text": masked})
    lists = shopping["rows"] if shopping else []
    for action in actions:
        if action["kind"] == "shopping_item":
            action["existing_in"] = [row["id"] for row in lists if any(
                normalize_title(item["title"]) == normalize_title(action["title"])
                for item in row.get("items", []))]
    if (shopping and shopping["status"] in {"ok", "empty"} and not lists
            and any(action["kind"] == "shopping_item" for action in actions)):
        actions.insert(0, {"id": str(uuid.uuid4()), "kind": "shopping_list", "title": None})
    actions = actions[:10]
    action_fields = {"id", "kind", "title", "qty", "unit", "description", "due_date",
                     "dish_id", "source_fact", "status", "existing_in"}
    actions = [{key: value for key, value in action.items() if key in action_fields}
               for action in actions]
    # Signed tokens have their own byte budget. Never repeat long source spans
    # in every action or return a report that cannot be prepared by its client.
    while len(json.dumps(actions, ensure_ascii=False, default=str).encode()) > 32000:
        actions.pop()
    questions = []
    if any(fact.get("conflicts_with_request") for fact in facts):
        # @copy-text assistant.stock_conflict_question
        question = "گفتید موجود نیست، اما مقدار ثبت‌شده مثبت است؛ موجودی واقعی را تأیید می‌کنید؟"
        questions.append(question)
    if any(fact["kind"] == "stock" and fact["status"] == "unknown" for fact in facts):
        # @copy-text assistant.stock_unknown_question
        questions.append("موجودی این ماده در اطلاعات ثبت‌شده روشن نیست؛ چه مقدار در خانه دارید؟")
    # Narrative only chooses verified facts/actions; it cannot supply computed values.
    report = ContextReport()
    count = 1
    if context or actions or financial:
        report = _infer(ContextReportIn(
            text=masked, context_json=_report_context(facts, actions, context),
        ), ContextReport, "/v1/assistant/report")
        count = 2
    known_facts = {fact["id"] for fact in facts}
    known_actions = {action["id"] for action in actions}
    if (any(key not in known_facts for key in report.finding_ids)
            or any(key not in known_actions for option in report.options
                   for key in option.action_ids)):
        raise AppError("AI_INVALID_RESULT", legacy.INVALID_RESULT, 502)
    from app.services.assistant_actions import sign_payload
    report_id = str(uuid.uuid4())
    stock_source = next((item for item in context if item["section"] == "inventory"), {})
    dishes = {item["id"]: item for source in context if source["section"] == "meals"
              for item in source["rows"]}
    signed_actions = []
    for action in actions:
        evidence = {}
        if action["kind"] in {"shopping_item", "meal_entry"}:
            if stock_source.get("status") in {"ok", "empty"}:
                evidence["stock_hash"] = stock_fingerprint(stock_source["rows"])
        if action.get("source_fact"):
            fact = next(item for item in facts if item["id"] == action["source_fact"])
            if fact["kind"] == "dish":
                evidence.update(dish_id=fact["dish_id"],
                                dish_revision=dishes[fact["dish_id"]]["revision"])
        signed_actions.append({**action, "evidence": evidence})
    token = sign_payload(actor, {"type": "report", "report_id": report_id,
                                 "actions": signed_actions,
                                  "reference_date": reference.isoformat()})
    # The model chooses groups, not display assertions. Labels are grounded in
    # the actual action and record title; free-text claims are not rendered.
    options = []
    by_action = {action["id"]: action for action in actions}
    for option in report.options:
        if not option.action_ids:
            continue
        titles = []
        for action_id in dict.fromkeys(option.action_ids):
            action = by_action[action_id]
            if action["kind"] == "meal_entry":
                # @copy-text assistant.option_meal
                title = f"برنامه‌ریزی وعده: «{action['title']}»"
            elif action["kind"] == "shopping_item":
                # @copy-text assistant.option_shopping
                title = f"افزودن به خرید: «{action['title']}»"
            elif action["kind"] == "task":
                # @copy-text assistant.option_task
                title = f"ساخت کار: «{action['title']}»"
            else:
                # @copy-text assistant.option_list
                title = "ساخت لیست خرید"
            titles.append(title)
        options.append({"title": " · ".join(titles),
                        "action_ids": list(dict.fromkeys(option.action_ids))})
    if plan.questions or report.questions or not (facts or actions or financial):
        # @copy-text assistant.clarify_request
        questions.append("کدام بخش از این درخواست را با چه تغییر مشخصی می‌خواهید دنبال کنید؟")
    # All deterministic facts are shown, even if the model omitted an inconvenient one.
    return {"protocol_version": 2, "reference_date": reference.isoformat(),
            "report_id": report_id, "report_token": token, "sections": context, "facts": facts,
            "actions": actions, "options": options,
            "questions": list(dict.fromkeys(questions))[:5],
            "proposals": financial, "unsupported": grounded["unsupported"], "inferences": count}
