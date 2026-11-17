"""Real PostgreSQL coverage for offline conflict handling and replay safety."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.conftest import API, Actor, add_active_member, expect_status
from tests.test_shopping import (
    check,
    complete,
    lists_of,
    new_item,
    new_list,
    new_stock,
    stock_of,
    txs_of,
)

OFFLINE = f"{API}/shopping/offline"
MUTATIONS = f"{OFFLINE}/mutations"


def mutation(kind: str, entity_id: str, revision: int | None, **payload) -> dict:
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": kind,
        "entity_id": entity_id,
        "base_revision": revision,
        "payload": payload,
    }


def send(client, actor: Actor, body: dict, status: int = 200) -> dict:
    res = client.post(MUTATIONS, headers=actor.h, json=body)
    expect_status(res, status)
    return res.json()


def snapshot(client, actor: Actor) -> dict:
    res = client.get(OFFLINE, headers=actor.h)
    expect_status(res, 200)
    return res.json()


def list_row(client, actor: Actor, list_id: str) -> dict:
    return next(row for row in snapshot(client, actor)["lists"] if row["id"] == list_id)


def stock_row(client, actor: Actor, item_id: str) -> dict:
    return next(row for row in snapshot(client, actor)["inventory"] if row["id"] == item_id)


def test_offline_endpoints_require_auth(client):
    expect_status(client.get(OFFLINE), 401)
    expect_status(
        client.post(MUTATIONS, json=mutation("list.create", str(uuid.uuid4()), None, title="لیست")),
        401,
    )


def test_snapshot_explicitly_excludes_money_and_identity(client, home_a):
    li = new_list(client, home_a)
    inv = new_stock(client, home_a)
    new_item(client, home_a, li["id"], price="45000", inventory_item_id=inv["id"])
    data = snapshot(client, home_a)
    forbidden = {
        "price",
        "transaction_id",
        "bought_by_member_id",
        "created_by",
        "family_id",
        "member_id",
        "amount",
        "account_id",
    }

    def walk(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(data)
    assert data["lists"][0]["items"][0]["qty"] == 1
    assert data["inventory"][0]["quantity"] == 1


def test_create_replay_preserves_stable_id_and_has_no_finance_side_effect(client, home_a):
    body = mutation("list.create", str(uuid.uuid4()), None, title="خرید آفلاین")
    first = send(client, home_a, body)
    second = send(client, home_a, body)
    assert first["entity_id"] == second["entity_id"] == body["entity_id"]
    assert first["revision"] == second["revision"] == 1
    assert first["replayed"] is False and second["replayed"] is True
    assert len(lists_of(client, home_a)) == 1
    assert txs_of(client, home_a) == []


def test_child_writes_advance_parent_once_including_no_op(client, home_a):
    li = new_list(client, home_a)
    assert list_row(client, home_a, li["id"])["revision"] == 1
    item_id = str(uuid.uuid4())
    created = send(
        client, home_a, mutation("item.create", item_id, None, list_id=li["id"], title="شیر")
    )
    assert created["revision"] == 1
    assert created["snapshot"]["lists"][0]["revision"] == 2
    checked = send(client, home_a, mutation("item.check", item_id, 1, checked=True))
    assert checked["revision"] == 2
    assert checked["snapshot"]["lists"][0]["revision"] == 3
    noop = send(client, home_a, mutation("item.check", item_id, 2, checked=True))
    assert noop["revision"] == 3
    assert noop["snapshot"]["lists"][0]["revision"] == 4
    removed = send(client, home_a, mutation("item.delete", item_id, 3))
    assert removed["revision"] is None
    assert removed["snapshot"]["lists"][0]["revision"] == 5


def test_other_members_online_check_conflicts_with_queued_edit(client, home_a):
    other = add_active_member(client, home_a)
    li = new_list(client, home_a)
    item = new_item(client, home_a, li["id"], price="12000")
    pending = mutation("item.update", item["id"], 1, title="شیر تازه", qty=2)
    expect_status(check(client, other, item["id"]), 200)
    result = send(client, home_a, pending, 409)
    assert result["error"] == "SYNC_CONFLICT"
    stored = lists_of(client, home_a)[0]["items"][0]
    assert stored["title"] == item["title"]
    assert stored["checked"] is True
    assert float(stored["price"]) == 12000


def test_offline_item_edit_preserves_server_price(client, home_a):
    li = new_list(client, home_a)
    item = new_item(client, home_a, li["id"], price="12000")
    send(client, home_a, mutation("item.update", item["id"], 1, title="نام تازه", qty=2))
    stored = lists_of(client, home_a)[0]["items"][0]
    assert stored["title"] == "نام تازه"
    assert float(stored["price"]) == 12000
    assert txs_of(client, home_a) == []


def test_adjust_replay_returns_current_snapshot_without_repeating_delta(client, home_a):
    inv = new_stock(client, home_a)
    body = mutation("inventory.adjust", inv["id"], 1, delta=1)
    first = send(client, home_a, body)
    assert first["revision"] == 2
    expect_status(
        client.post(f"{API}/inventory/{inv['id']}/adjust", headers=home_a.h, json={"delta": 2}), 200
    )
    replay = send(client, home_a, body)
    assert replay["revision"] == 2  # original acknowledgment
    assert replay["snapshot"]["inventory"][0]["revision"] == 3
    assert replay["snapshot"]["inventory"][0]["quantity"] == 4


def test_stale_adjust_does_not_change_stock(client, home_a):
    inv = new_stock(client, home_a)
    pending = mutation("inventory.adjust", inv["id"], 1, delta=-1)
    expect_status(
        client.post(f"{API}/inventory/{inv['id']}/adjust", headers=home_a.h, json={"delta": 2}), 200
    )
    send(client, home_a, pending, 409)
    assert float(stock_of(client, home_a)[0]["quantity"]) == 3


def test_reusing_operation_with_different_content_is_rejected(client, home_a):
    body = mutation("list.create", str(uuid.uuid4()), None, title="اول")
    send(client, home_a, body)
    changed = {**body, "payload": {"title": "دوم"}}
    result = send(client, home_a, changed, 409)
    assert result["error"] == "OPERATION_REUSED"
    assert lists_of(client, home_a)[0]["title"] == "اول"


def test_stale_list_delete_cannot_remove_new_shared_items(client, home_a):
    li = new_list(client, home_a)
    body = mutation("list.delete", li["id"], 1)
    new_item(client, home_a, li["id"])
    send(client, home_a, body, 409)
    assert len(lists_of(client, home_a)[0]["items"]) == 1


def test_delete_receipt_replays_after_target_is_gone(client, home_a):
    li = new_list(client, home_a)
    body = mutation("list.delete", li["id"], 1)
    send(client, home_a, body)
    assert send(client, home_a, body)["replayed"] is True
    assert lists_of(client, home_a) == []


def test_other_tenant_cannot_read_mutate_or_replay_receipt(client, home_a, home_b):
    li = new_list(client, home_a)
    body = mutation("list.update", li["id"], 1, title="تازه")
    send(client, home_a, body)
    foreign_snapshot = snapshot(client, home_b)
    assert {key: foreign_snapshot[key] for key in ("lists", "inventory", "tasks")} == {
        "lists": [],
        "inventory": [],
        "tasks": [],
    }
    send(client, home_b, body, 404)
    assert lists_of(client, home_a)[0]["title"] == "تازه"


def test_checkout_changes_item_and_inventory_revisions(client, home_a):
    li = new_list(client, home_a)
    inv = new_stock(client, home_a)
    item = new_item(client, home_a, li["id"], price="20000", inventory_item_id=inv["id"])
    expect_status(check(client, home_a, item["id"]), 200)
    stale_item = mutation("item.check", item["id"], 2, checked=False)
    stale_stock = mutation("inventory.adjust", inv["id"], 1, delta=1)
    expect_status(complete(client, home_a, li["id"]), 200)
    send(client, home_a, stale_item, 409)
    send(client, home_a, stale_stock, 409)
    data = snapshot(client, home_a)
    assert data["lists"][0]["items"] == []
    assert data["lists"][0]["revision"] == 4
    assert data["inventory"][0]["quantity"] == 2
    assert data["inventory"][0]["revision"] == 2
    assert len(txs_of(client, home_a)) == 1


@pytest.mark.parametrize(
    "extra",
    [
        {"price": 10},
        {"transaction_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"bought_at": "2026-11-12"},
        {"family_id": str(uuid.uuid4())},
        {"checked": True},
    ],
)
def test_sensitive_or_state_fields_are_rejected(client, home_a, extra):
    li = new_list(client, home_a)
    body = mutation("item.create", str(uuid.uuid4()), None, list_id=li["id"], title="نان")
    body["payload"].update(extra)
    send(client, home_a, body, 422)
    assert lists_of(client, home_a)[0]["items"] == []
    assert txs_of(client, home_a) == []


def test_foreign_inventory_link_is_rejected(client, home_a, home_b):
    li = new_list(client, home_a)
    foreign = new_stock(client, home_b)
    body = mutation(
        "item.create",
        str(uuid.uuid4()),
        None,
        list_id=li["id"],
        title="نان",
        inventory_item_id=foreign["id"],
    )
    send(client, home_a, body, 404)
    assert lists_of(client, home_a)[0]["items"] == []


def test_concurrent_identical_adjustment_is_applied_once(client, home_a):
    inv = new_stock(client, home_a)
    body = mutation("inventory.adjust", inv["id"], 1, delta=1)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(lambda _: client.post(MUTATIONS, headers=home_a.h, json=body), range(2))
        )
    for result in results:
        expect_status(result, 200)
    assert sorted(result.json()["replayed"] for result in results) == [False, True]
    assert stock_row(client, home_a, inv["id"])["quantity"] == 2
