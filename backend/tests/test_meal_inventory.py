"""The reviewed meal gesture is atomic, retryable, and bound to one household."""
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.conftest import API, add_active_member, expect_status
from tests.test_meals import create_dish, create_entry, dishes_of, edit_dish, plan_of
from tests.test_shopping import new_item, new_list, new_stock, one_list, stock_of, txs_of

CHECK = f"{API}/meals/ingredients/check"
CONFIRM = f"{API}/meals/plan/confirm"
RICE = {"title": "برنج", "catalog_id": "preset:برنج", "qty": None, "unit": None}
UNKNOWN = {"title": "مادهٔ اختصاصی خانه", "qty": None, "unit": None}


def selection(**fields):
    return {"operation_id": str(uuid.uuid4()), "date": "2026-11-14", "meal_type": "lunch",
            "dish": {"title": "غذای آزمایشی", "ingredients": [RICE, UNKNOWN]},
            "decisions": [], **fields}


def review(client, actor, ingredients):
    response = client.post(CHECK, headers=actor.h, json={"ingredients": ingredients})
    return expect_status(response, 200).json()


def confirm(client, actor, body, status=200):
    return expect_status(client.post(CONFIRM, headers=actor.h, json=body), status).json()


def decisions(*actions):
    return [{"key": f"ingredient:{index}", "action": action,
             **({"qty": "1.25", "unit": "کیلو"} if action == "shopping" else {})}
            for index, action in enumerate(actions)]


def test_presence_uses_identity_and_unknown_stays_unresolved(client, home_a, home_b):
    new_stock(client, home_a, title="برنج", quantity=2, unit="کیلو")
    original = stock_of(client, home_a)
    checked = review(client, home_a, [RICE, UNKNOWN])
    assert [row["status"] for row in checked] == ["available", "unresolved"]
    assert checked[0]["ingredient"]["qty"] is None
    assert review(client, home_b, [RICE])[0]["status"] == "missing"
    renamed = review(client, home_a, [{**RICE, "title": "عنوان متفاوت با ارتباط صریح"}])
    assert renamed[0]["status"] == "available"
    assert review(client, home_a, [{**RICE, "qty": "3", "unit": "کیلو"}])[0]["status"] == "missing"
    assert stock_of(client, home_a) == original


def test_zero_inventory_requires_a_decision(client, home_a):
    new_stock(client, home_a, title="برنج", quantity=0)
    assert review(client, home_a, [RICE])[0]["status"] == "missing"
    confirm(client, home_a, selection(dish={"title": "برنج ساده", "ingredients": [RICE]}), 409)
    assert dishes_of(client, home_a) == [] and plan_of(client, home_a)["entries"] == []


def test_every_missing_and_unresolved_ingredient_needs_an_explicit_decision(client, home_a):
    body = selection(decisions=decisions("available"))
    assert confirm(client, home_a, body, 409)["error"] == "MEAL_REVIEW_REQUIRED"
    assert dishes_of(client, home_a) == []
    body["decisions"] = decisions("available", "available")
    result = confirm(client, home_a, body)
    assert result["added_count"] == 0
    assert stock_of(client, home_a) == [] and txs_of(client, home_a) == []


def test_mixed_decisions_save_one_meal_and_only_selected_shopping_atomically(client, home_a):
    li = new_list(client, home_a)
    original_stock = stock_of(client, home_a)
    body = selection(list_id=li["id"], decisions=decisions("shopping", "available"),
                     meal_type="snack")
    result = confirm(client, home_a, body)
    assert result["entry"]["meal_type"] == "snack"
    assert result["dish"]["ingredients"][0]["catalog_id"] == RICE["catalog_id"]
    assert all(row["qty"] is None for row in result["dish"]["ingredients"])
    assert result["added_count"] == 1 and not result["replayed"]
    items = one_list(client, home_a, li["id"])["items"]
    assert len(items) == 1 and items[0]["qty"] == "1.25" and items[0]["title"] == "برنج"
    assert len(plan_of(client, home_a)["entries"]) == 1
    assert stock_of(client, home_a) == original_stock and txs_of(client, home_a) == []
    replay = confirm(client, home_a, body)
    assert replay["replayed"] and replay["entry"]["id"] == result["entry"]["id"]
    assert len(dishes_of(client, home_a)) == 1
    assert len(one_list(client, home_a, li["id"])["items"]) == 1
    body["decisions"][0]["qty"] = 2
    assert confirm(client, home_a, body, 409)["error"] == "OPERATION_REUSED"


def test_conflicting_slot_rolls_back_new_dish_shopping_and_receipt(client, home_a):
    dish = create_dish(client, home_a)
    create_entry(client, home_a, dish)
    li = new_list(client, home_a)
    body = selection(list_id=li["id"], decisions=decisions("shopping", "available"))
    assert confirm(client, home_a, body, 409)["error"] == "MEAL_SLOT_OCCUPIED"
    assert one_list(client, home_a, li["id"])["items"] == []
    assert len(dishes_of(client, home_a)) == 1
    body["meal_type"] = "dinner"
    assert not confirm(client, home_a, body)["replayed"]


@pytest.mark.parametrize("qty", [None, 0, -1, True, "0.001", "100000000"])
def test_invalid_purchase_amount_cannot_partially_save(client, home_a, qty):
    li = new_list(client, home_a)
    choices = decisions("shopping", "available")
    choices[0]["qty"] = qty
    confirm(client, home_a, selection(list_id=li["id"], decisions=choices), 422)
    assert dishes_of(client, home_a) == [] and one_list(client, home_a, li["id"])["items"] == []


def test_existing_alias_shopping_row_keeps_amount_price_and_note(client, home_a):
    li = new_list(client, home_a)
    existing = new_item(client, home_a, li["id"], title="برنج", qty=8, price=1200, note="یادداشت")
    before = one_list(client, home_a, li["id"])["items"]
    body = selection(list_id=li["id"], decisions=decisions("shopping", "available"))
    result = confirm(client, home_a, body)
    assert result["skipped_count"] == 1 and result["added_count"] == 0
    assert one_list(client, home_a, li["id"])["items"] == before
    assert before[0]["id"] == existing["id"]


def test_foreign_list_and_dish_and_other_members_entry_cannot_be_used(client, home_a, home_b):
    foreign_list = new_list(client, home_b)
    body = selection(list_id=foreign_list["id"], decisions=decisions("shopping", "available"))
    confirm(client, home_a, body, 404)
    foreign_dish = create_dish(client, home_b)
    body = selection(dish=None, dish_id=foreign_dish["id"], dish_revision=foreign_dish["revision"])
    confirm(client, home_a, body, 404)
    dish = create_dish(client, home_a)
    entry = create_entry(client, home_a, dish)
    other = add_active_member(client, home_a, "عضو دیگر")
    body = selection(entry_id=entry["id"], base_revision=entry["revision"])
    confirm(client, other, body, 403)
    assert len(dishes_of(client, home_a)) == 1 and len(plan_of(client, home_a)["entries"]) == 1


def test_changed_dish_requires_fresh_review_and_does_not_purchase(client, home_a):
    dish = create_dish(client, home_a, ingredients=[RICE])
    li = new_list(client, home_a)
    expect_status(edit_dish(client, home_a, dish, title="عنوان تازه"), 200)
    body = selection(dish=None, dish_id=dish["id"], dish_revision=dish["revision"],
                     list_id=li["id"], decisions=decisions("shopping"))
    confirm(client, home_a, body, 409)
    assert one_list(client, home_a, li["id"])["items"] == []


def test_duplicate_concurrent_gestures_return_one_receipt(client, home_a):
    li = new_list(client, home_a)
    body = selection(list_id=li["id"], decisions=decisions("shopping", "available"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda _: client.post(CONFIRM, headers=home_a.h, json=body), range(2)
        ))
    assert sorted(expect_status(res, 200).json()["replayed"] for res in results) == [False, True]
    assert len(dishes_of(client, home_a)) == 1
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


def test_stock_is_rechecked_after_review_before_any_write(client, home_a):
    stock = new_stock(client, home_a, title="برنج", quantity=2)
    assert review(client, home_a, [RICE])[0]["status"] == "available"
    expect_status(client.post(f"{API}/inventory/{stock['id']}/adjust", headers=home_a.h,
                              json={"delta": -2}), 200)
    body = selection(dish={"title": "برنج ساده", "ingredients": [RICE]})
    confirm(client, home_a, body, 409)
    assert dishes_of(client, home_a) == []
    body["decisions"] = decisions("available")
    confirm(client, home_a, body)
    assert stock_of(client, home_a)[0]["quantity"] == "0.00"


def test_untrusted_catalog_and_duplicate_or_unknown_decision_keys_are_rejected(client, home_a):
    bad = {**RICE, "catalog_id": "preset:not-a-reviewed-catalog-entry"}
    expect_status(client.post(CHECK, headers=home_a.h, json={"ingredients": [bad]}), 422)
    for choices in [decisions("available", "available") + decisions("available"),
                    [{"key": "not-an-ingredient", "action": "available"}]]:
        confirm(client, home_a, selection(decisions=choices), 422)
    assert dishes_of(client, home_a) == []
