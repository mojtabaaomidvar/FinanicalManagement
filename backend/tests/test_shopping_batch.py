"""Atomic, tenant-scoped shopping imports and retry acknowledgements."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text

from tests.conftest import Actor, add_active_member, expect_status
from tests.test_shopping import (
    ITEMS,
    LISTS,
    check,
    complete,
    new_item,
    new_list,
    new_stock,
    one_list,
    stock_of,
    txs_of,
)
from tests.test_shopping_offline import MUTATIONS, list_row, mutation, send


def batch(*items: dict, operation_id: str | None = None) -> dict:
    return {"operation_id": operation_id or str(uuid.uuid4()), "items": list(items)}


def ensure(client, actor: Actor, list_id: str, body: dict, status: int = 200) -> dict:
    response = client.post(f"{LISTS}/{list_id}/ensure-missing", headers=actor.h, json=body)
    expect_status(response, status)
    return response.json()


def test_import_normalizes_aggregates_and_rounds_without_stock_or_money_effects(client, home_a):
    li = new_list(client, home_a)
    new_stock(client, home_a, title="برنج", unit="کیلو")
    before_stock = stock_of(client, home_a)
    body = batch(
        {"title": "  برنج   ایرانی ", "qty": "1.235", "unit": " کیلو "},
        {"title": "برنج ایرانی", "qty": "0.505", "unit": "کیلو"},
        {"title": "نان", "qty": 1, "unit": "  "},
        {"title": " نان ", "qty": 2, "unit": None},
    )
    result = ensure(client, home_a, li["id"], body)
    assert result["operation_id"] == body["operation_id"]
    assert result["list_id"] == li["id"] and result["replayed"] is False
    assert result["added_count"] == 2 and result["skipped_count"] == 0
    assert result["skipped"] == []
    added = {row["title"]: row for row in result["added"]}
    assert added["برنج ایرانی"]["qty"] == "1.75"
    assert added["برنج ایرانی"]["unit"] == "کیلو"
    assert added["نان"]["qty"] == "3.00" and added["نان"]["unit"] is None
    assert all(set(row) == {"id", "title", "qty", "unit"} for row in result["added"])
    stored = one_list(client, home_a, li["id"])["items"]
    assert {row["id"] for row in stored} == {row["id"] for row in result["added"]}
    assert all(row["inventory_item_id"] is None and row["price"] is None for row in stored)
    assert stock_of(client, home_a) == before_stock
    assert txs_of(client, home_a) == []


def test_existing_pending_item_is_skipped_and_all_its_fields_are_preserved(client, home_a):
    li = new_list(client, home_a)
    stock = new_stock(client, home_a, title="شیر", unit="لیتر")
    existing = new_item(
        client, home_a, li["id"], title="شیر", qty="3.25", unit="لیتر",
        price="78000", note="کم‌چرب", inventory_item_id=stock["id"],
    )
    expect_status(check(client, home_a, existing["id"]), 200)
    before = one_list(client, home_a, li["id"])["items"][0]
    before_revision = list_row(client, home_a, li["id"])["revision"]
    result = ensure(
        client, home_a, li["id"], batch({"title": " شیر ", "qty": 99, "unit": "بسته"}),
    )
    assert result["added"] == [] and result["added_count"] == 0
    assert result["skipped"] == [{"id": existing["id"], "title": "شیر"}]
    assert result["skipped_count"] == 1
    assert one_list(client, home_a, li["id"])["items"][0] == before
    assert list_row(client, home_a, li["id"])["revision"] == before_revision
    assert txs_of(client, home_a) == []
    assert stock_of(client, home_a)[0]["quantity"] == "1.00"


@pytest.mark.parametrize("other_unit", ["گرم", None])
def test_conflicting_units_are_rejected_before_any_item_or_receipt_write(
    client, home_a, other_unit,
):
    li = new_list(client, home_a)
    body = batch(
        {"title": "نان", "qty": 1, "unit": None},
        {"title": " برنج ", "qty": 2, "unit": "کیلو"},
        {"title": "برنج", "qty": 3, "unit": other_unit},
    )
    ensure(client, home_a, li["id"], body, 422)
    assert one_list(client, home_a, li["id"])["items"] == []
    # Rejection must not consume the operation ID.
    body["items"] = [{"title": "برنج", "qty": 5, "unit": "کیلو"}]
    assert ensure(client, home_a, li["id"], body)["replayed"] is False


@pytest.mark.parametrize(
    "item",
    [
        {"title": "  ", "qty": 1},
        {"title": "نان", "qty": 0},
        {"title": "نان", "qty": -1},
        {"title": "نان", "qty": "0.001"},
        {"title": "نان", "qty": "NaN"},
        {"title": "نان", "qty": "Infinity"},
        {"title": "نان", "qty": "100000000"},
        {"title": "نان", "qty": 1, "price": 100},
        {"title": "نان", "qty": 1, "inventory_item_id": str(uuid.uuid4())},
        {"title": "نان", "qty": 1, "checked": True},
    ],
)
def test_invalid_or_unapproved_item_fields_fail_atomically(client, home_a, item):
    li = new_list(client, home_a)
    ensure(client, home_a, li["id"], batch({"title": "شیر", "qty": 1}, item), 422)
    assert one_list(client, home_a, li["id"])["items"] == []


def test_rejects_extra_request_fields_and_raw_item_limit_before_aggregation(client, home_a):
    li = new_list(client, home_a)
    body = batch({"title": "نان", "qty": 1})
    ensure(client, home_a, li["id"], {**body, "family_id": home_a.family_id}, 422)
    ensure(client, home_a, li["id"], {**body, "operation_id": "invalid"}, 422)
    ensure(client, home_a, li["id"], batch(*[{"title": "نان", "qty": 1}] * 251), 422)
    assert one_list(client, home_a, li["id"])["items"] == []


def test_aggregate_quantity_overflow_is_rejected_atomically(client, home_a):
    li = new_list(client, home_a)
    ensure(
        client, home_a, li["id"],
        batch({"title": "نان", "qty": "99999999"}, {"title": "نان", "qty": 1}),
        422,
    )
    assert one_list(client, home_a, li["id"])["items"] == []


def test_bought_items_do_not_prevent_a_fresh_pending_item(client, home_a):
    li = new_list(client, home_a)
    bought = new_item(client, home_a, li["id"], title="نان")
    expect_status(check(client, home_a, bought["id"]), 200)
    expect_status(complete(client, home_a, li["id"]), 200)
    result = ensure(client, home_a, li["id"], batch({"title": "نان", "qty": 2}))
    assert result["added_count"] == 1 and result["skipped_count"] == 0
    assert result["added"][0]["id"] != bought["id"]
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


def test_replay_returns_original_acknowledgement_after_edits_and_deletions(client, home_a):
    li = new_list(client, home_a)
    skipped = new_item(client, home_a, li["id"], title="شیر", qty=5)
    body = batch({"title": "شیر", "qty": 1}, {"title": "نان", "qty": "2.125"})
    first = ensure(client, home_a, li["id"], body)
    added_id = first["added"][0]["id"]
    expect_status(
        client.patch(f"{ITEMS}/{skipped['id']}", headers=home_a.h, json={"title": "ماست"}),
        200,
    )
    expect_status(client.delete(f"{ITEMS}/{added_id}", headers=home_a.h), 204)
    replay = ensure(client, home_a, li["id"], body)
    assert replay == {**first, "replayed": True}
    assert [item["title"] for item in one_list(client, home_a, li["id"])["items"]] == ["ماست"]


def test_batch_receipt_stores_no_ingredient_or_existing_item_details(client, raw_sql, home_a):
    li = new_list(client, home_a)
    new_item(client, home_a, li["id"], title="شیر", qty=12, unit="بسته", note="یادداشت")
    body = batch({"title": "شیر", "qty": 3}, {"title": "برنج", "qty": 2, "unit": "کیلو"})
    result = ensure(client, home_a, li["id"], body)
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": home_a.family_id},
    )
    receipt = raw_sql.execute(
        text(
            "SELECT result_json FROM shopping_sync_receipts "
            "WHERE family_id=:family AND member_id=:member AND operation_id=:operation"
        ),
        {"family": home_a.family_id, "member": home_a.member_id, "operation": body["operation_id"]},
    ).scalar_one()

    def assert_opaque(value):
        if isinstance(value, dict):
            assert not {"title", "qty", "unit", "note", "price"}.intersection(value)
            for child in value.values():
                assert_opaque(child)
        elif isinstance(value, list):
            for child in value:
                assert_opaque(child)
        elif isinstance(value, str):
            assert value not in {"شیر", "برنج", "کیلو", "بسته", "یادداشت"}

    assert_opaque(receipt)
    assert result["added_count"] == 1 and result["skipped_count"] == 1
    raw_sql.rollback()


@pytest.mark.parametrize("field,value", [("title", "ماست"), ("qty", 3), ("unit", "کیلو")])
def test_reused_operation_with_changed_body_is_rejected(client, home_a, field, value):
    li = new_list(client, home_a)
    body = batch({"title": "نان", "qty": 2, "unit": None})
    first = ensure(client, home_a, li["id"], body)
    changed = {**body, "items": [{**body["items"][0], field: value}]}
    assert ensure(client, home_a, li["id"], changed, 409)["error"] == "OPERATION_REUSED"
    assert ensure(client, home_a, li["id"], body) == {**first, "replayed": True}
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


def test_reused_operation_with_changed_path_is_rejected(client, home_a):
    first_list = new_list(client, home_a)
    other_list = new_list(client, home_a, "دیگر")
    body = batch({"title": "نان", "qty": 1})
    ensure(client, home_a, first_list["id"], body)
    assert ensure(client, home_a, other_list["id"], body, 409)["error"] == "OPERATION_REUSED"
    assert one_list(client, home_a, other_list["id"])["items"] == []


@pytest.mark.parametrize("offline_first", [True, False])
def test_operation_ids_cannot_be_reused_between_batch_and_offline_apis(
    client, home_a, offline_first,
):
    li = new_list(client, home_a)
    body = batch({"title": "نان", "qty": 1})
    queued = mutation("item.create", str(uuid.uuid4()), None, list_id=li["id"], title="شیر")
    queued["operation_id"] = body["operation_id"]
    if offline_first:
        send(client, home_a, queued)
        denied = ensure(client, home_a, li["id"], body, 409)
    else:
        ensure(client, home_a, li["id"], body)
        denied = send(client, home_a, queued, 409)
    assert denied["error"] == "OPERATION_REUSED"
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


def test_auth_missing_foreign_and_inactive_members_cannot_import_or_replay(
    client, raw_sql, home_a, home_b,
):
    li = new_list(client, home_a)
    member = add_active_member(client, home_a)
    body = batch({"title": "نان", "qty": 1})
    expect_status(client.post(f"{LISTS}/{li['id']}/ensure-missing", json=body), 401)
    ensure(client, home_b, li["id"], body, 404)
    ensure(client, home_a, str(uuid.uuid4()), body, 404)
    first = ensure(client, member, li["id"], body)
    assert first["added_count"] == 1
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:id"),
        {"id": member.member_id},
    )
    raw_sql.commit()
    assert ensure(client, member, li["id"], body, 403)["error"] == "MEMBERSHIP_INACTIVE"
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


def test_receipts_are_scoped_to_family_and_member(client, home_a, home_b):
    li = new_list(client, home_a)
    other_list = new_list(client, home_b)
    member = add_active_member(client, home_a)
    body = batch({"title": "نان", "qty": 1})
    assert ensure(client, home_a, li["id"], body)["added_count"] == 1
    same_family = ensure(client, member, li["id"], body)
    assert same_family["replayed"] is False and same_family["skipped_count"] == 1
    other_family = ensure(client, home_b, other_list["id"], body)
    assert other_family["replayed"] is False and other_family["added_count"] == 1


def test_capacity_guard_is_atomic_and_existing_items_can_be_skipped_at_capacity(client, home_a):
    li = new_list(client, home_a)
    for start in (0, 250):
        result = ensure(
            client, home_a, li["id"],
            batch(*[{"title": f"قلم {index}", "qty": 1} for index in range(start, start + 250)]),
        )
        assert result["added_count"] == 250
    body = batch({"title": "قلم 0", "qty": 2}, {"title": "اضافه", "qty": 1})
    assert ensure(client, home_a, li["id"], body, 409)["error"] == "LIMIT_REACHED"
    assert len(one_list(client, home_a, li["id"])["items"]) == 500
    existing_only = batch({"title": "قلم 0", "qty": 2})
    assert ensure(client, home_a, li["id"], existing_only)["skipped_count"] == 1
    # A rejected batch must remain eligible after space is made.
    removed = one_list(client, home_a, li["id"])["items"][-1]
    expect_status(client.delete(f"{ITEMS}/{removed['id']}", headers=home_a.h), 204)
    retry = ensure(client, home_a, li["id"], body)
    assert retry["replayed"] is False and retry["added_count"] == 1
    assert len(one_list(client, home_a, li["id"])["items"]) == 500


@pytest.mark.parametrize("same_operation", [True, False])
def test_concurrent_batches_have_one_pending_item_and_stable_receipts(
    client, home_a, same_operation,
):
    li = new_list(client, home_a)
    first = batch({"title": "نان", "qty": 1})
    second = first if same_operation else batch({"title": "نان", "qty": 1})
    gate = Barrier(2)

    def post(body):
        gate.wait(timeout=10)
        return client.post(f"{LISTS}/{li['id']}/ensure-missing", headers=home_a.h, json=body)

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(post, (first, second)))
    for response in responses:
        expect_status(response, 200)
    results = [response.json() for response in responses]
    if same_operation:
        assert sorted(result["replayed"] for result in results) == [False, True]
        assert results[0]["added"] == results[1]["added"]
    else:
        assert sorted(result["added_count"] for result in results) == [0, 1]
        assert sorted(result["skipped_count"] for result in results) == [0, 1]
    assert len(one_list(client, home_a, li["id"])["items"]) == 1


@pytest.mark.parametrize(
    "writer", ["online_create", "offline_create", "online_edit", "offline_edit"],
)
def test_batch_and_existing_item_writers_cannot_create_duplicate_pending_titles(
    client, home_a, writer,
):
    li = new_list(client, home_a)
    seeded = (
        new_item(client, home_a, li["id"], title="قلم قبلی") if writer.endswith("edit") else None
    )
    body = batch({"title": "چای", "qty": 2})
    gate = Barrier(2)

    def post_batch():
        gate.wait(timeout=10)
        return client.post(f"{LISTS}/{li['id']}/ensure-missing", headers=home_a.h, json=body)

    def post_writer():
        gate.wait(timeout=10)
        if writer == "online_create":
            return client.post(f"{LISTS}/{li['id']}/items", headers=home_a.h, json={"title": "چای"})
        if writer == "online_edit":
            return client.patch(f"{ITEMS}/{seeded['id']}", headers=home_a.h, json={"title": "چای"})
        queued = (
            mutation("item.update", seeded["id"], 1, title="چای")
            if writer == "offline_edit"
            else mutation("item.create", str(uuid.uuid4()), None, list_id=li["id"], title="چای")
        )
        return client.post(MUTATIONS, headers=home_a.h, json=queued)

    with ThreadPoolExecutor(max_workers=2) as executor:
        batch_future = executor.submit(post_batch)
        writer_future = executor.submit(post_writer)
        batch_response, writer_response = batch_future.result(), writer_future.result()
    expect_status(batch_response, 200)
    assert writer_response.status_code in {200, 201, 409}, writer_response.text
    pending = one_list(client, home_a, li["id"])["items"]
    assert sum(row["title"] == "چای" for row in pending) == 1
    result = batch_response.json()
    assert result["added_count"] + result["skipped_count"] == 1
    if writer_response.status_code == 409:
        assert result["added_count"] == 1
    else:
        assert result["skipped_count"] == 1
