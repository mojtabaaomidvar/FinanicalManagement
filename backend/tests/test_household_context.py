"""Contextual analysis uses synthetic inference and the isolated test database only."""
import json
from decimal import Decimal

import pytest

from app.core.config import settings
from app.services import contextual_assistant
from app.services.household_context import ingredient_status, normalize_title
from tests.conftest import API, expect_status


@pytest.mark.parametrize(("title", "expected"), [
    ("نون", "نان"), ("  پنير  ", "پنیر"), ("نان سنگک", "نان سنگک"),
])
def test_pure_title_normalization_is_narrow(title, expected):
    assert normalize_title(title) == expected


@pytest.mark.parametrize(("rows", "required", "expected"), [
    ([], {"title": "نان", "qty": "1", "unit": "عدد"}, "unknown"),
    ([{"title": "نان", "quantity": "0", "unit": "عدد"}],
     {"title": "نون", "qty": "1", "unit": "عدد"}, "missing"),
    ([{"title": "نان", "quantity": "2", "unit": "عدد"}],
     {"title": "نان", "qty": "1", "unit": "عدد"}, "available"),
    ([{"title": "پنیر", "quantity": "0.1", "unit": "کیلوگرم"}],
     {"title": "پنیر", "qty": "100", "unit": "گرم"}, "available"),
    ([{"title": "پنیر", "quantity": "20", "unit": "گرم"}],
     {"title": "پنیر", "qty": "100", "unit": "گرم"}, "missing"),
    ([{"title": "نان", "quantity": "1", "unit": "بسته"}],
     {"title": "نان", "qty": "2", "unit": "عدد"}, "unknown"),
    ([{"title": "نان سنگک", "quantity": "3", "unit": "عدد"}],
     {"title": "نان", "qty": "1", "unit": "عدد"}, "unknown"),
])
def test_pure_ingredient_status_never_invents_stock_or_unit_conversion(rows, required, expected):
    result = ingredient_status(required, rows)
    assert result["status"] == expected
    if expected == "missing":
        assert Decimal(result["shortage"]) > 0


def test_pure_ambiguous_inventory_rows_are_unknown():
    rows = [{"title": "نان", "quantity": "1", "unit": "عدد"},
            {"title": "نون", "quantity": "2", "unit": "عدد"}]
    result = ingredient_status({"title": "نان", "qty": "1", "unit": "عدد"}, rows)
    assert result["status"] == "unknown"


@pytest.mark.parametrize("quantity", ["0", "2"])
@pytest.mark.parametrize("unit", [None, "عدد"])
def test_name_only_ingredient_remains_unknown_with_matching_inventory(quantity, unit):
    ingredient = {"title": "نان", "qty": None, "unit": unit}
    result = ingredient_status(ingredient, [
        {"id": "bread", "title": "نان", "quantity": quantity, "unit": "عدد"},
    ])
    assert result == {**ingredient, "status": "unknown", "shortage": None,
                      "inventory_id": "bread"}


@pytest.fixture
def contextual_provider(monkeypatch):
    monkeypatch.setattr(settings, "ai_sms_gateway_url", "")
    monkeypatch.setattr(settings, "deepseek_api_key", "synthetic-context-key")
    calls = []
    plan = {"sections": ["meals", "inventory", "shopping"], "terms": ["نان"], "proposals": []}

    def complete(messages, **_options):
        data = json.loads(messages[1]["content"])
        calls.append(data)
        if "context_json" not in data:
            return plan
        context = json.loads(data["context_json"])
        return {"finding_ids": [fact["id"] for fact in context["facts"]],
                "options": [{"title": "پیشنهاد خرید", "action_ids": [action["id"]
                             for action in context["actions"]
                             if action["kind"] == "shopping_item"]}]}

    monkeypatch.setattr(contextual_assistant, "request_deepseek_json", complete)
    return calls, plan


def report(client, home, text="نون نداریم برای صبحونه"):
    return client.post(API + "/assistant/report", headers=home.h, json={"text": text})


def seed_breakfast(client, home, quantity=None):
    if quantity is not None:
        expect_status(client.post(API + "/inventory", headers=home.h, json={
            "title": "نان", "quantity": quantity, "unit": "عدد",
        }), 201)
    expect_status(client.post(API + "/inventory", headers=home.h, json={
        "title": "پنیر", "quantity": 100, "unit": "گرم",
    }), 201)
    return expect_status(client.post(API + "/meals/dishes", headers=home.h, json={
        "title": "نان و پنیر", "ingredients": [{"title": "نان", "qty": 1, "unit": "عدد"},
                                             {"title": "پنیر", "qty": 20, "unit": "گرم"}],
    }), 201).json()


@pytest.mark.parametrize(("quantity", "expected"), [(None, "unknown"), (0, "missing"),
                                                     (2, "available")])
def test_report_bread_grounding_has_no_price_financial_write_or_unknown_zero(
    client, home_a, contextual_provider, quantity, expected,
):
    calls, _ = contextual_provider
    seed_breakfast(client, home_a, quantity)
    paths = ["/transactions", "/shopping/lists", "/tasks", "/inventory", "/meals/dishes"]
    before = {path: client.get(API + path, headers=home_a.h).json() for path in paths}
    value = expect_status(report(client, home_a), 200).json()
    dish = next(fact for fact in value["facts"] if fact["kind"] == "dish")
    assert dish["status"] == expected and value["proposals"] == []
    assert "price" not in str(value["actions"])
    assert {item["section"] for item in value["sections"]} == {"inventory", "shopping", "meals"}
    assert value["inferences"] == len(calls) == 2
    for path, rows in before.items():
        assert client.get(API + path, headers=home_a.h).json() == rows


def prepare(client, home, value, candidate, **fields):
    return client.post(API + "/assistant/prepare-action", headers=home.h, json={
        "report_token": value["report_token"], "action_id": candidate["id"], **fields,
    })


def execute(client, home, review, **extra):
    return client.post(API + "/assistant/execute", headers=home.h,
                       json={"review_token": review["review_token"], "confirmed": True, **extra})


def test_confirmed_shopping_replay_receipt_scope_and_price_are_safe(
    client, home_a, home_b, member_a, contextual_provider,
):
    calls, _ = contextual_provider
    seed_breakfast(client, home_a, 0)
    parent = expect_status(client.post(API + "/shopping/lists", headers=home_a.h,
                                       json={"title": "خرید خانه"}), 201).json()
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_item")
    assert prepare(client, home_b, value, candidate, list_id=parent["id"], qty=1).status_code == 422
    assert prepare(client, home_a, value, candidate, list_id=parent["id"]).status_code == 422
    review = expect_status(prepare(client, home_a, value, candidate,
                                   list_id=parent["id"], qty=1, unit="عدد"), 200).json()
    assert client.get(API + "/shopping/lists", headers=home_a.h).json()[0]["items"] == []
    assert execute(client, home_a, review, confirmed=False).status_code == 422
    first = expect_status(execute(client, home_a, review), 200).json()
    replay = expect_status(execute(client, home_a, review), 200).json()
    assert first["entity_id"] == replay["entity_id"] and replay["replayed"] is True
    path = API + "/assistant/receipt/" + review["operation_id"]
    assert client.get(path, headers=home_a.h).json()["entity_id"] == first["entity_id"]
    assert client.get(path, headers=member_a.h).status_code == 404
    assert client.get(path, headers=home_b.h).status_code == 404
    items = client.get(API + "/shopping/lists", headers=home_a.h).json()[0]["items"]
    assert len(items) == 1 and items[0]["price"] is None and items[0]["bought_at"] is None
    assert len(calls) == 2


def test_changed_review_cannot_reuse_successful_operation_key(client, home_a, contextual_provider):
    seed_breakfast(client, home_a, 0)
    parent = expect_status(client.post(API + "/shopping/lists", headers=home_a.h,
                                       json={"title": "خرید"}), 201).json()
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_item")
    first = prepare(client, home_a, value, candidate, list_id=parent["id"], qty=1).json()
    expect_status(execute(client, home_a, first), 200)
    changed = prepare(client, home_a, value, candidate, list_id=parent["id"], qty=2).json()
    assert execute(client, home_a, changed).status_code == 409


def test_meal_review_checks_slot_and_revision_before_atomic_write(
    client, home_a, contextual_provider,
):
    dish = seed_breakfast(client, home_a, 2)
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "meal_entry")
    review = prepare(client, home_a, value, candidate,
                     due_date=value["reference_date"], meal_type="breakfast").json()
    expect_status(client.patch(API + "/meals/dishes/" + dish["id"], headers=home_a.h,
                               json={"title": "نان و پنیر تازه", "ingredients": dish["ingredients"],
                                     "base_revision": dish["revision"]}), 200)
    assert execute(client, home_a, review).status_code == 409
    assert prepare(client, home_a, value, candidate,
                   due_date=value["reference_date"], meal_type="breakfast").status_code == 409
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "meal_entry")
    review = prepare(client, home_a, value, candidate,
                      due_date=value["reference_date"], meal_type="breakfast").json()
    expect_status(execute(client, home_a, review), 200)
    assert prepare(client, home_a, value, candidate,
                   due_date=value["reference_date"], meal_type="breakfast").status_code == 409


def test_contextual_api_refuses_arbitrary_tools_and_cross_family_reads(
    client, home_a, home_b, contextual_provider,
):
    calls, _ = contextual_provider
    seed_breakfast(client, home_b, 0)
    response = report(client, home_a)
    assert "نان و پنیر" not in response.text
    assert client.post(API + "/assistant/report", headers=home_a.h,
                       json={"text": "private", "url": "https://evil.invalid"}).status_code == 422
    assert client.post(API + "/assistant/report", json={"text": "private"}).status_code == 401
    assert len(calls) == 2


def test_every_read_adapter_is_honest_on_empty_house(client, home_a, contextual_provider):
    from app.services.household_ai_protocol import SECTIONS
    _, plan = contextual_provider
    plan.update(sections=SECTIONS, terms=[])
    value = expect_status(report(client, home_a, "وضعیت قسمت‌های خانه را بررسی کن"), 200).json()
    assert len(value["sections"]) == len(SECTIONS)
    assert all(row["status"] == "empty" for row in value["sections"]
               if row["section"] != "market")
    market = next(row for row in value["sections"] if row["section"] == "market")
    assert market["status"] == "unavailable"


def test_positive_stock_conflict_is_explicit(client, home_a, contextual_provider):
    seed_breakfast(client, home_a, 2)
    value = expect_status(report(client, home_a), 200).json()
    stock = next(fact for fact in value["facts"] if fact["kind"] == "stock")
    assert stock["conflicts_with_request"] is True and value["questions"]
    assert value["proposals"] == []


def test_report_cannot_omit_food_sources(client, home_a, contextual_provider):
    _, plan = contextual_provider
    plan.update(sections=[], terms=[])
    value = expect_status(report(client, home_a), 200).json()
    assert {source["section"] for source in value["sections"]} == {
        "inventory", "shopping", "meals",
    }


def test_stock_change_invalidates_both_old_report_and_prepared_review(
    client, home_a, contextual_provider,
):
    seed_breakfast(client, home_a, 0)
    parent = expect_status(client.post(API + "/shopping/lists", headers=home_a.h,
                                       json={"title": "خرید"}), 201).json()
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_item")
    review = prepare(client, home_a, value, candidate, list_id=parent["id"], qty=1).json()
    stock = next(row for row in client.get(API + "/inventory", headers=home_a.h).json()
                 if row["title"] == "نان")
    expect_status(client.patch(API + "/inventory/" + stock["id"], headers=home_a.h, json={
        "title": stock["title"], "quantity": 3, "unit": stock["unit"],
    }), 200)
    assert prepare(client, home_a, value, candidate,
                   list_id=parent["id"], qty=1).status_code == 409
    assert execute(client, home_a, review).status_code == 409
    assert client.get(API + "/shopping/lists", headers=home_a.h).json()[0]["items"] == []


def test_expiration_blocks_new_writes_but_not_saved_receipt_replay(
    client, home_a, contextual_provider, monkeypatch,
):
    from app.services import assistant_actions
    seed_breakfast(client, home_a, 0)
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_list")
    review = prepare(client, home_a, value, candidate, title="صبحانه").json()
    first = expect_status(execute(client, home_a, review), 200).json()
    now = assistant_actions.time.time()
    monkeypatch.setattr(assistant_actions.time, "time", lambda: now + 901)
    assert prepare(client, home_a, value, candidate, title="صبحانه").status_code == 409
    replay = expect_status(execute(client, home_a, review), 200).json()
    assert replay["replayed"] and replay["entity_id"] == first["entity_id"]
    assert len(client.get(API + "/shopping/lists", headers=home_a.h).json()) == 1


def test_duplicate_shopping_is_existing_without_a_second_item(
    client, home_a, contextual_provider,
):
    seed_breakfast(client, home_a, 0)
    parent = expect_status(client.post(API + "/shopping/lists", headers=home_a.h,
                                       json={"title": "خرید"}), 201).json()
    expect_status(client.post(API + "/shopping/lists/" + parent["id"] + "/items",
                              headers=home_a.h, json={"title": "نان", "qty": 1}), 201)
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_item")
    assert candidate["existing_in"] == [parent["id"]]
    review = prepare(client, home_a, value, candidate, list_id=parent["id"], qty=1).json()
    assert expect_status(execute(client, home_a, review), 200).json()["status"] == "existing"
    assert len(client.get(API + "/shopping/lists", headers=home_a.h).json()[0]["items"]) == 1


def test_concurrent_confirmations_make_one_entity_and_one_receipt(
    client, home_a, contextual_provider,
):
    from concurrent.futures import ThreadPoolExecutor
    seed_breakfast(client, home_a, 0)
    value = expect_status(report(client, home_a), 200).json()
    candidate = next(item for item in value["actions"] if item["kind"] == "shopping_list")
    review = prepare(client, home_a, value, candidate, title="صبحانه").json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: execute(client, home_a, review), range(2)))
    rows = [expect_status(response, 200).json() for response in responses]
    assert rows[0]["entity_id"] == rows[1]["entity_id"]
    assert sorted(row["replayed"] for row in rows) == [False, True]
    assert len(client.get(API + "/shopping/lists", headers=home_a.h).json()) == 1


def test_populated_context_adapters_keep_private_records_and_sensitive_numbers_out(
    client, home_a, member_a, contextual_provider,
):
    from tests.test_children import create_child
    from tests.test_documents import create_doc
    from tests.test_equipment import create_equipment
    from tests.test_goals import create_goal
    from tests.test_pets import create_pet
    from tests.test_tasks import create_task
    from tests.test_vehicles import create_vehicle
    calls, plan = contextual_provider
    create_child(client, home_a, name="آراد")
    create_pet(client, home_a, name="برفی")
    create_equipment(client, home_a)
    create_vehicle(client, home_a, plate="SECRET-PLATE")
    create_doc(client, home_a, title="PRIVATE-OWNER-DOCUMENT")
    create_goal(client, home_a, title="PRIVATE-OWNER-GOAL")
    create_task(client, home_a, description="رمز 123456 و شماره 09121234567")
    plan.update(sections=["children", "pets", "equipment", "vehicles", "documents",
                          "goals", "tasks"], terms=[])
    own = expect_status(report(client, home_a, "قسمت‌های مرتبط خانه را بررسی کن"), 200).json()
    assert all(source["status"] == "ok" for source in own["sections"])
    provider_data = json.dumps(calls[-1], ensure_ascii=False)
    assert "SECRET-PLATE" not in provider_data and "09121234567" not in provider_data
    assert "123456" not in provider_data
    assert "file_name" not in provider_data and "storage_path" not in provider_data
    value = expect_status(report(client, member_a, "قسمت‌های مرتبط خانه را بررسی کن"), 200).json()
    assert "PRIVATE-OWNER-DOCUMENT" not in str(value)
    assert "PRIVATE-OWNER-GOAL" not in str(value)
    assert "SECRET-PLATE" not in str(value)


def test_truncated_context_never_claims_ingredient_sufficiency(
    client, home_a, contextual_provider, monkeypatch,
):
    from app.services import household_context
    seed_breakfast(client, home_a, 2)
    monkeypatch.setattr(household_context, "MAX_ROWS", 1)
    value = expect_status(report(client, home_a), 200).json()
    assert next(source for source in value["sections"]
                if source["section"] == "inventory")["status"] == "limited"
    assert all(fact["status"] == "unknown" for fact in value["facts"]
               if fact["kind"] in {"stock", "dish"})


def test_untrusted_narrative_cannot_claim_prices_stock_or_execution(
    client, home_a, contextual_provider, monkeypatch,
):
    from app.services import household_ai_protocol
    seed_breakfast(client, home_a, 0)
    original = contextual_assistant._infer
    def infer(body, schema, path):
        if schema is household_ai_protocol.ContextReport:
            data = json.loads(body.context_json)
            return schema.model_validate({
                "options": [{"title": "نان خریداری شد و قیمت قطعی ۵۰۰۰۰ است",
                             "action_ids": [data["actions"][-1]["id"]]}],
                "questions": ["موجودی قطعی صد عدد است و پرداخت انجام شد؟"],
            })
        return original(body, schema, path)
    monkeypatch.setattr(contextual_assistant, "_infer", infer)
    value = expect_status(report(client, home_a), 200).json()
    assert "خریداری شد" not in str(value) and "قیمت قطعی" not in str(value)
    assert "پرداخت انجام شد" not in str(value)


def test_destination_rename_rejects_old_review_without_receipt(client, home_a, contextual_provider):
    seed_breakfast(client, home_a, 0)
    parent = expect_status(client.post(API + "/shopping/lists", headers=home_a.h,
                                       json={"title": "خرید"}), 201).json()
    value = expect_status(report(client, home_a), 200).json()
    action = next(row for row in value["actions"] if row["kind"] == "shopping_item")
    review = expect_status(prepare(client, home_a, value, action,
                                   list_id=parent["id"], qty=1), 200).json()
    expect_status(client.patch(API + "/shopping/lists/" + parent["id"],
                               headers=home_a.h, json={"title": "نام تازه"}), 200)
    assert execute(client, home_a, review).status_code == 409
    assert client.get(API + "/assistant/receipt/" + review["operation_id"],
                      headers=home_a.h).status_code == 404
    assert client.get(API + "/shopping/lists", headers=home_a.h).json()[0]["items"] == []


def test_failed_receipt_insert_rolls_back_the_business_write(
    client, home_a, contextual_provider, monkeypatch,
):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    from app.models.assistant_execution import AssistantExecutionReceipt
    seed_breakfast(client, home_a, 0)
    value = expect_status(report(client, home_a), 200).json()
    action = next(row for row in value["actions"] if row["kind"] == "shopping_list")
    review = expect_status(prepare(client, home_a, value, action, title="صبحانه"), 200).json()
    original = Session.add
    def add(db, row, *args, **kwargs):
        if isinstance(row, AssistantExecutionReceipt):
            raise IntegrityError("synthetic receipt failure", {}, Exception())
        return original(db, row, *args, **kwargs)
    monkeypatch.setattr(Session, "add", add)
    assert execute(client, home_a, review).status_code == 409
    assert client.get(API + "/shopping/lists", headers=home_a.h).json() == []


def test_populated_finance_events_bills_and_cached_market_are_grounded_and_read_only(
    client, home_a, member_a, contextual_provider, monkeypatch,
):
    from app.schemas.market import MarketItemOut
    from app.services import market
    from app.services.member_age import today_tehran
    from tests.conftest import make_account, make_category_budget, make_holding
    from tests.test_bills import new_bill
    calls, plan = contextual_provider
    own = make_account(client, home_a, title="OWN-ACCOUNT")
    make_account(client, member_a, title="OTHER-MEMBER-ACCOUNT")
    make_category_budget(client, home_a)
    make_holding(client, home_a)
    day = today_tehran().isoformat()
    new_bill(client, home_a, due=day)
    expect_status(client.post(API + "/events", headers=home_a.h,
                               json={"title": "قرار امروز", "date": day}), 201)
    for account_id in [own, None]:
        expect_status(client.post(API + "/transactions", headers=home_a.h, json={
            "member_id": home_a.member_id, "type": "expense", "amount": "1250.25",
            "category": "shopping", "date": day, "account_id": account_id,
        }), 201)
    item = MarketItemOut(symbol="TEST", name="قیمت نمونه", price=1234, change_value=0,
                         change_percent=0, unit="تومان", date=day, time="12:00")
    entry = market._Entry(([item], [], []))
    entry.at -= 600
    monkeypatch.setattr(market, "_prices_cache", entry)
    monkeypatch.setattr(market, "_fetch", lambda *_a, **_kw: pytest.fail("no market fetch"))
    plan.update(sections=["finance", "events", "bills", "holdings", "market"], terms=[])
    value = expect_status(report(client, home_a, "رکوردهای مرتبط را بررسی کن"), 200).json()
    by_section = {source["section"]: source for source in value["sections"]}
    assert all(source["status"] == "ok" for source in by_section.values())
    finance = by_section["finance"]["rows"]
    assert len([row for row in finance if row["type"] == "expense"]) == 2
    assert "OTHER-MEMBER-ACCOUNT" not in str(value)
    assert all(row["amount"] == "1250.25" for row in finance if row["type"] == "expense")
    assert all(row["money_unit"] == "toman" for row in finance
               if row["amount"] is not None or row["initial_balance"] is not None)
    assert by_section["bills"]["rows"][0]["money_unit"] == "toman"
    assert by_section["market"]["rows"][0]["stale"] is True
    assert "+00:00" in by_section["market"]["rows"][0]["cached_at"]
    assert len(calls) == 2 and not value["proposals"]


@pytest.mark.parametrize("revoked", ["actor", "assignee"])
def test_current_membership_is_required_after_task_review(
    client, raw_sql, home_a, member_a, contextual_provider, revoked,
):
    from sqlalchemy import text
    _, plan = contextual_provider
    request = "آشپزخانه را تمیز کن"
    plan.update(sections=["tasks"], terms=[], proposals=[{
        "kind": "task", "title": "تمیزکردن آشپزخانه", "source_text": request,
    }])
    value = expect_status(report(client, home_a, request), 200).json()
    action = value["actions"][0]
    review = expect_status(prepare(client, home_a, value, action,
                                   assignee_id=member_a.member_id), 200).json()
    member_id = home_a.member_id if revoked == "actor" else member_a.member_id
    raw_sql.execute(text("UPDATE members SET membership_state='suspended' WHERE id=:id"),
                    {"id": member_id})
    raw_sql.commit()
    assert execute(client, home_a, review).status_code == (403 if revoked == "actor" else 422)
    observer = member_a if revoked == "actor" else home_a
    assert client.get(API + "/tasks", headers=observer.h).json() == []


def test_minor_and_cross_family_context_preserve_adapter_access_boundaries(
    client, raw_sql, home_a, home_b, member_a, contextual_provider,
):
    from sqlalchemy import text

    from app.services.household_ai_protocol import SECTIONS
    from tests.test_children import create_child
    from tests.test_documents import create_doc
    from tests.test_pets import create_pet
    create_child(client, home_a, name="PRIVATE-CHILD")
    create_pet(client, home_a, name="PRIVATE-PET")
    create_doc(client, home_a, title="PRIVATE-DOCUMENT", visibility="shared")
    raw_sql.execute(text("UPDATE members SET birth_date='2015-01-01', relation='فرزند' "
                         "WHERE id=:id"), {"id": member_a.member_id})
    raw_sql.commit()
    _, plan = contextual_provider
    plan.update(sections=SECTIONS, terms=[])
    value = expect_status(report(client, member_a, "بخش‌های مجاز را بررسی کن"), 200).json()
    sections = {item["section"]: item for item in value["sections"]}
    assert sections["documents"]["status"] == "forbidden"
    # Their existing shared read contracts allow active minors; only writes
    # require a manager. The adapter must not invent a different role policy.
    assert sections["children"]["status"] == "ok"
    assert sections["pets"]["status"] == "ok"
    assert "PRIVATE-CHILD" in str(value) and "PRIVATE-PET" in str(value)
    other = expect_status(report(client, home_b, "بخش‌های مجاز را بررسی کن"), 200).json()
    assert "PRIVATE-DOCUMENT" not in str(value) and "PRIVATE-" not in str(other)


def test_concurrent_distinct_reviews_cannot_overwrite_one_meal_slot(
    client, home_a, contextual_provider,
):
    from concurrent.futures import ThreadPoolExecutor
    seed_breakfast(client, home_a, 2)
    reports = [expect_status(report(client, home_a), 200).json() for _ in range(2)]
    reviews = [expect_status(prepare(client, home_a, value,
                                     next(action for action in value["actions"]
                                          if action["kind"] == "meal_entry"),
                                     due_date=value["reference_date"], meal_type="breakfast"),
                             200).json() for value in reports]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda review: execute(client, home_a, review), reviews))
    assert sorted(response.status_code for response in responses) == [200, 409]
    statuses = [client.get(API + "/assistant/receipt/" + review["operation_id"],
                           headers=home_a.h).status_code for review in reviews]
    assert sorted(statuses) == [200, 404]


def test_missing_dependency_never_creates_an_item_or_a_receipt(client, home_a, contextual_provider):
    seed_breakfast(client, home_a, 0)
    value = expect_status(report(client, home_a), 200).json()
    action = next(item for item in value["actions"] if item["kind"] == "shopping_item")
    response = prepare(client, home_a, value, action, qty=1)
    assert response.status_code == 422
    assert client.get(API + "/shopping/lists", headers=home_a.h).json() == []


def test_report_payload_budget_compacts_only_model_details_not_authoritative_facts():
    from app.services.household_ai_protocol import ContextReportIn
    rows = [{"id": str(index), "title": "نان", "description": "x" * 2000}
            for index in range(40)]
    facts = [{"id": f"stock-{index}", "kind": "stock", "title": "نان",
              "section": "inventory", "status": "unknown", "rows": rows}
             for index in range(8)]
    actions = [{"id": "action", "kind": "shopping_item", "title": "نان"}]
    sources = [{"section": "inventory", "status": "limited", "reference_date": "2026-11-23"}]
    encoded = contextual_assistant._report_context(facts, actions, sources)
    ContextReportIn(text="نون نداریم", context_json=encoded)
    bounded = json.loads(encoded)
    assert bounded["detail_omitted_for_budget"] is True
    assert [fact["id"] for fact in bounded["facts"]] == [fact["id"] for fact in facts]
    assert all(fact["status"] == "unknown" for fact in bounded["facts"])
    assert bounded["actions"] == actions and all(fact["rows"] == rows for fact in facts)


def test_context_clipping_redacts_sensitive_values_before_the_boundary():
    from app.services.household_context import _has_long_text, _project_nested, _sanitize
    value = "x" * 1995 + " 09121234567"
    assert _has_long_text(value) is True
    assert "0912" not in _sanitize(value)
    row = _project_nested({"participant_ids": [str(index) for index in range(50)]})
    assert len(row["participant_ids"]) == 40
