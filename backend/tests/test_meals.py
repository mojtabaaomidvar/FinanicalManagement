"""Real HTTP/PostgreSQL coverage for shared meals, versioning and tenant boundaries."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import API, AUTH, add_active_member, expect_status

DISHES = f"{API}/meals/dishes"
PLAN = f"{API}/meals/plan"
SATURDAY = "2026-11-14"


def create_dish(client, actor, **fields):
    return expect_status(
        client.post(
            DISHES,
            headers=actor.h,
            json={"title": "عدس پلو", **fields},
        ),
        201,
    ).json()


def dishes_of(client, actor):
    return expect_status(client.get(DISHES, headers=actor.h), 200).json()


def edit_dish(client, actor, dish, **fields):
    return client.patch(
        f"{DISHES}/{dish['id']}",
        headers=actor.h,
        json={
            "base_revision": dish["revision"],
            "title": dish["title"],
            "ingredients": dish["ingredients"],
            **fields,
        },
    )


def create_entry(client, actor, dish, **fields):
    return expect_status(
        client.post(
            PLAN,
            headers=actor.h,
            json={
                "date": SATURDAY,
                "meal_type": "lunch",
                "dish_id": dish["id"],
                **fields,
            },
        ),
        201,
    ).json()


def plan_of(client, actor, week=SATURDAY):
    return expect_status(client.get(PLAN, headers=actor.h, params={"week_start": week}), 200).json()


def edit_entry(client, actor, entry, **fields):
    return client.patch(
        f"{PLAN}/{entry['id']}",
        headers=actor.h,
        json={
            "base_revision": entry["revision"],
            "dish_id": entry["dish_id"],
            **fields,
        },
    )


def delete(client, actor, path, row, revision=None):
    return client.delete(
        f"{path}/{row['id']}",
        headers=actor.h,
        params={
            "base_revision": row["revision"] if revision is None else revision,
        },
    )


def test_dish_crud_cleans_aggregates_and_advances_noop_revision(client, home_a):
    dish = create_dish(
        client,
        home_a,
        title="  عدس   پلو  ",
        ingredients=[
            {"title": " برنج ", "qty": "1.005", "unit": " پیمانه "},
            {"title": "برنج", "qty": "0.5", "unit": "پیمانه"},
            {"title": "عدس", "qty": "1", "unit": " "},
        ],
    )
    assert dish["title"] == "عدس پلو"
    assert dish["ingredients"] == [
        {"title": "برنج", "qty": "1.51", "unit": "پیمانه"},
        {"title": "عدس", "qty": "1.00", "unit": None},
    ]
    assert dish["created_by"] == home_a.member_id
    assert dish["revision"] == 1 and dish["can_edit"] and dish["can_delete"]
    assert dishes_of(client, home_a) == [dish]
    changed = expect_status(edit_dish(client, home_a, dish, title="عدسی"), 200).json()
    assert changed["revision"] == 2 and changed["updated_at"] >= dish["updated_at"]
    noop = expect_status(edit_dish(client, home_a, changed), 200).json()
    assert noop["revision"] == 3
    expect_status(delete(client, home_a, DISHES, noop), 204)
    assert dishes_of(client, home_a) == []


def test_week_includes_saturday_to_friday_in_meal_order(client, home_a):
    dish = create_dish(client, home_a)
    create_entry(client, home_a, dish, date="2026-11-13")
    dinner = create_entry(client, home_a, dish, meal_type="dinner")
    breakfast = create_entry(client, home_a, dish, meal_type="breakfast")
    friday = create_entry(client, home_a, dish, date="2026-11-20")
    create_entry(client, home_a, dish, date="2026-11-21")
    plan = plan_of(client, home_a)
    assert plan["week_start"] == SATURDAY
    assert [row["id"] for row in plan["entries"]] == [breakfast["id"], dinner["id"], friday["id"]]
    assert len(plan_of(client, home_a, "2026-11-21")["entries"]) == 1


def test_entry_change_keeps_slot_and_prevents_referenced_dish_deletion(client, home_a):
    first = create_dish(client, home_a)
    second = create_dish(client, home_a, title="املت")
    entry = create_entry(client, home_a, first)
    assert entry["revision"] == 1 and entry["created_by"] == home_a.member_id
    assert entry["can_edit"] and entry["can_delete"]
    referenced = next(row for row in dishes_of(client, home_a) if row["id"] == first["id"])
    assert referenced["can_edit"] and not referenced["can_delete"]
    rejected = expect_status(delete(client, home_a, DISHES, first), 409).json()
    assert rejected["error"] == "DISH_IN_USE"
    current = expect_status(edit_entry(client, home_a, entry, dish_id=second["id"]), 200).json()
    assert current["revision"] == 2 and current["dish_id"] == second["id"]
    assert current["date"] == entry["date"] and current["meal_type"] == entry["meal_type"]
    noop = expect_status(edit_entry(client, home_a, current), 200).json()
    assert noop["revision"] == 3
    expect_status(delete(client, home_a, DISHES, first), 204)
    expect_status(delete(client, home_a, PLAN, noop), 204)
    expect_status(delete(client, home_a, DISHES, second), 204)
    assert plan_of(client, home_a)["entries"] == []


def test_shared_permissions_allow_creator_and_both_admin_roles(client, home_a):
    creator = add_active_member(client, home_a, "سازنده")
    other = add_active_member(client, home_a, "عضو دیگر")
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    dish = create_dish(client, creator)
    entry = create_entry(client, creator, dish)
    assert not dishes_of(client, other)[0]["can_edit"]
    assert not plan_of(client, other)["entries"][0]["can_delete"]
    expect_status(edit_dish(client, other, dish), 403)
    expect_status(delete(client, other, DISHES, dish), 403)
    expect_status(edit_entry(client, other, entry), 403)
    expect_status(delete(client, other, PLAN, entry), 403)
    # Any active member can put another member's dish into a different slot.
    shared_entry = create_entry(client, other, dish, meal_type="dinner")
    expect_status(delete(client, other, PLAN, shared_entry), 204)
    dish = expect_status(edit_dish(client, creator, dish), 200).json()
    dish = expect_status(edit_dish(client, admin, dish), 200).json()
    entry = expect_status(edit_entry(client, home_a, entry), 200).json()
    entry = expect_status(edit_entry(client, admin, entry), 200).json()
    expect_status(delete(client, admin, PLAN, entry), 204)
    expect_status(delete(client, home_a, DISHES, dish), 204)


def test_meals_family_ids_cannot_be_read_changed_or_referenced(client, home_a, home_b):
    dish = create_dish(client, home_a)
    entry = create_entry(client, home_a, dish)
    assert dishes_of(client, home_b) == [] and plan_of(client, home_b)["entries"] == []
    expect_status(edit_dish(client, home_b, dish), 404)
    expect_status(delete(client, home_b, DISHES, dish), 404)
    expect_status(edit_entry(client, home_b, entry), 404)
    expect_status(delete(client, home_b, PLAN, entry), 404)
    expect_status(
        client.post(
            PLAN,
            headers=home_b.h,
            json={
                "date": SATURDAY,
                "meal_type": "lunch",
                "dish_id": dish["id"],
            },
        ),
        404,
    )
    other_dish = create_dish(client, home_b)
    expect_status(edit_entry(client, home_a, entry, dish_id=other_dish["id"]), 404)
    assert plan_of(client, home_a)["entries"] == [entry]


def test_stale_revisions_cannot_change_or_delete_dishes_and_entries(client, home_a):
    dish = create_dish(client, home_a)
    current_dish = expect_status(edit_dish(client, home_a, dish, title="نسخه تازه"), 200).json()
    expect_status(edit_dish(client, home_a, dish, title="نسخه قدیمی"), 409)
    expect_status(delete(client, home_a, DISHES, dish), 409)
    entry = create_entry(client, home_a, current_dish)
    current_entry = expect_status(edit_entry(client, home_a, entry), 200).json()
    expect_status(edit_entry(client, home_a, entry), 409)
    expect_status(delete(client, home_a, PLAN, entry), 409)
    assert plan_of(client, home_a)["entries"] == [current_entry]
    assert dishes_of(client, home_a)[0]["title"] == "نسخه تازه"


def test_two_concurrent_slot_creations_have_one_winner(client, home_a):
    first = create_dish(client, home_a)
    second = create_dish(client, home_a, title="کوکو")

    def submit(dish):
        return client.post(
            PLAN,
            headers=home_a.h,
            json={
                "date": SATURDAY,
                "meal_type": "lunch",
                "dish_id": dish["id"],
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, [first, second]))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(plan_of(client, home_a)["entries"]) == 1
    conflict = next(response for response in responses if response.status_code == 409)
    assert conflict.json()["error"] == "MEAL_SLOT_OCCUPIED"


@pytest.mark.parametrize("entity", ["dish", "entry"])
def test_two_concurrent_changes_cannot_overwrite_the_same_revision(client, home_a, entity):
    dish = create_dish(client, home_a)
    if entity == "dish":

        def submit(title):
            return edit_dish(client, home_a, dish, title=title)
    else:
        entry = create_entry(client, home_a, dish)
        first = create_dish(client, home_a, title="اول")
        second = create_dish(client, home_a, title="دوم")

        def submit(title):
            chosen = first if title == "اول" else second
            return edit_entry(client, home_a, entry, dish_id=chosen["id"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, ["اول", "دوم"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert winner["revision"] == 2
    stored = (
        dishes_of(client, home_a)[0] if entity == "dish" else plan_of(client, home_a)["entries"][0]
    )
    assert stored["id"] == winner["id"] and stored["revision"] == 2
    assert (
        stored["title" if entity == "dish" else "dish_id"]
        == winner["title" if entity == "dish" else "dish_id"]
    )


def test_every_meal_route_requires_a_session_and_active_membership(client, raw_sql, home_a):
    member = add_active_member(client, home_a)
    dish = create_dish(client, member)
    entry = create_entry(client, member, dish)
    requests = [
        ("get", DISHES, {}),
        ("post", DISHES, {"json": {"title": "غذا"}}),
        (
            "patch",
            f"{DISHES}/{dish['id']}",
            {
                "json": {"title": "غذا", "base_revision": 1},
            },
        ),
        ("delete", f"{DISHES}/{dish['id']}", {"params": {"base_revision": 1}}),
        ("get", PLAN, {"params": {"week_start": SATURDAY}}),
        (
            "post",
            PLAN,
            {
                "json": {
                    "date": SATURDAY,
                    "meal_type": "dinner",
                    "dish_id": dish["id"],
                }
            },
        ),
        (
            "patch",
            f"{PLAN}/{entry['id']}",
            {
                "json": {"dish_id": dish["id"], "base_revision": 1},
            },
        ),
        ("delete", f"{PLAN}/{entry['id']}", {"params": {"base_revision": 1}}),
    ]
    for method, path, options in requests:
        expect_status(getattr(client, method)(path, **options), 401)
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:mid"),
        {"mid": member.member_id},
    )
    raw_sql.commit()
    for method, path, options in requests:
        response = expect_status(getattr(client, method)(path, headers=member.h, **options), 403)
        assert response.json()["error"] == "MEMBERSHIP_INACTIVE"
    assert plan_of(client, home_a)["entries"][0]["id"] == entry["id"]


@pytest.mark.parametrize(
    "extra",
    [
        {"family_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"revision": 99},
        {"notes": "پزشکی"},
        {"servings": 4},
        {"title": " "},
        {"ingredients": [{"title": "برنج", "qty": 0}]},
        {"ingredients": [{"title": "برنج", "qty": -1}]},
        {"ingredients": [{"title": "برنج", "qty": True}]},
        {"ingredients": [{"title": "برنج", "qty": "NaN"}]},
        {"ingredients": [{"title": "برنج", "qty": "Infinity"}]},
        {"ingredients": [{"title": "برنج", "qty": "0.001"}]},
        {"ingredients": [{"title": "برنج", "qty": "100000000"}]},
        {"ingredients": [{"title": " "}]},
        {"ingredients": [{"title": "برنج", "unit": "x" * 21}]},
        {"ingredients": [{"title": "برنج", "price": 100}]},
        {"ingredients": [{"title": "برنج", "inventory_item_id": str(uuid.uuid4())}]},
        {"ingredients": [{"title": f"ماده {i}"} for i in range(51)]},
    ],
)
def test_dish_inputs_reject_spoofing_scope_expansion_and_bad_ingredients(client, home_a, extra):
    expect_status(client.post(DISHES, headers=home_a.h, json={"title": "غذا", **extra}), 422)
    assert dishes_of(client, home_a) == []


def test_duplicate_ingredient_units_and_aggregate_overflow_reject_atomically(client, home_a):
    for ingredients in (
        [{"title": "برنج", "unit": "کیلو"}, {"title": " برنج ", "unit": "پیمانه"}],
        [{"title": "برنج", "qty": "99999999"}, {"title": "برنج", "qty": "1"}],
    ):
        expect_status(
            client.post(
                DISHES,
                headers=home_a.h,
                json={
                    "title": "غذا",
                    "ingredients": ingredients,
                },
            ),
            422,
        )
    assert dishes_of(client, home_a) == []


@pytest.mark.parametrize(
    "extra",
    [
        {"date": 0},
        {"date": "2026-11-14T00:00:00Z"},
        {"date": "2026-02-30"},
        {"meal_type": "snack"},
        {"dish_id": "bad-id"},
        {"family_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"note": "یادداشت"},
        {"servings": 2},
    ],
)
def test_slot_inputs_are_narrow_and_calendar_days(client, home_a, extra):
    dish = create_dish(client, home_a)
    expect_status(
        client.post(
            PLAN,
            headers=home_a.h,
            json={
                "date": SATURDAY,
                "meal_type": "lunch",
                "dish_id": dish["id"],
                **extra,
            },
        ),
        422,
    )
    assert plan_of(client, home_a)["entries"] == []


@pytest.mark.parametrize("week", ["2026-11-15", "2026-02-30", "2026-11-14T00:00:00Z", "9999-12-31"])
def test_week_start_must_be_a_saturday_calendar_day(client, home_a, week):
    expect_status(client.get(PLAN, headers=home_a.h, params={"week_start": week}), 422)


def test_slot_patch_cannot_move_the_day_or_meal_type(client, home_a):
    dish = create_dish(client, home_a)
    entry = create_entry(client, home_a, dish)
    for extra in ({"date": "2026-11-15"}, {"meal_type": "dinner"}, {"base_revision": True}):
        expect_status(edit_entry(client, home_a, entry, **extra), 422)
    assert plan_of(client, home_a)["entries"] == [entry]


def test_dish_limit_returns_conflict_without_inserting(client, home_a, monkeypatch):
    from app.services import meals

    monkeypatch.setattr(meals, "_MAX_DISHES", 2)
    create_dish(client, home_a)
    create_dish(client, home_a, title="دوم")
    expect_status(client.post(DISHES, headers=home_a.h, json={"title": "سوم"}), 409)
    assert len(dishes_of(client, home_a)) == 2


def test_creator_deletion_preserves_shared_meals_for_admins(client, raw_sql, home_a):
    creator = add_active_member(client, home_a)
    dish = create_dish(client, creator)
    entry = create_entry(client, creator, dish)
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": home_a.family_id}
    )
    raw_sql.execute(text("DELETE FROM members WHERE id=:mid"), {"mid": creator.member_id})
    raw_sql.commit()
    stored = dishes_of(client, home_a)[0]
    stored_entry = plan_of(client, home_a)["entries"][0]
    assert stored["id"] == dish["id"] and stored["created_by"] is None and stored["can_edit"]
    assert stored_entry["id"] == entry["id"] and stored_entry["created_by"] is None
    assert stored_entry["can_edit"] and stored_entry["can_delete"]


def test_database_composite_fk_rejects_cross_family_dish(client, raw_sql, home_a, home_b):
    dish = create_dish(client, home_b)
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": home_a.family_id}
    )
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO meal_entries (family_id, date, meal_type, dish_id) "
                "VALUES (:fid, '2026-11-14', 'lunch', :did)"
            ),
            {"fid": home_a.family_id, "did": dish["id"]},
        )
    assert error.value.orig.diag.constraint_name == "fk_meal_entry_dish_family"
    raw_sql.rollback()


def test_family_deletion_cascades_referenced_dishes_and_entries(client, raw_sql, home_a):
    dish = create_dish(client, home_a)
    create_entry(client, home_a, dish)
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": home_a.family_id}
    )
    raw_sql.execute(text("DELETE FROM families WHERE id=:fid"), {"fid": home_a.family_id})
    raw_sql.commit()
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": home_a.family_id}
    )
    assert raw_sql.execute(text("SELECT count(*) FROM meal_dishes")).scalar_one() == 0
    assert raw_sql.execute(text("SELECT count(*) FROM meal_entries")).scalar_one() == 0
    raw_sql.rollback()


def test_meals_are_excluded_from_offline_protocol_and_do_not_touch_money_or_stock(client, home_a):
    dish = create_dish(client, home_a, ingredients=[{"title": "برنج", "qty": "1"}])
    create_entry(client, home_a, dish)
    snapshot = expect_status(client.get(f"{API}/shopping/offline", headers=home_a.h), 200).json()
    assert (
        "meal_dishes" not in snapshot and "meal_entries" not in snapshot and "meals" not in snapshot
    )
    expect_status(
        client.post(
            f"{API}/shopping/offline/mutations",
            headers=home_a.h,
            json={
                "operation_id": str(uuid.uuid4()),
                "kind": "meal.create",
                "entity_id": str(uuid.uuid4()),
                "base_revision": None,
                "payload": {"title": "غذا"},
            },
        ),
        422,
    )
    assert expect_status(client.get(f"{API}/inventory", headers=home_a.h), 200).json() == []
    assert expect_status(client.get(f"{API}/shopping/lists", headers=home_a.h), 200).json() == []
    transactions = expect_status(client.get(f"{API}/transactions", headers=home_a.h), 200).json()
    assert transactions == []
    assert Decimal(dish["ingredients"][0]["qty"]) == Decimal(1)
