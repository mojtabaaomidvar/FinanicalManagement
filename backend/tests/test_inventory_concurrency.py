"""Shared inventory increments must survive concurrent checkout and direct adjustment."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from decimal import Decimal
from threading import Barrier, Event, get_ident

import pytest
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

from tests.conftest import expect_status
from tests.test_shopping import STOCK, check, complete, new_item, new_list, new_stock, one_list, stock_of, txs_of


def while_stock_is_locked(raw_sql, actor, stock, request):
    """Change stock but hold its row lock until the competing request is waiting."""
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": actor.family_id})
    raw_sql.execute(text("UPDATE inventory_items SET quantity=10 WHERE id=:id"), {"id": stock["id"]})
    selected, main_thread = Event(), get_ident()
    def before_select(connection, cursor, statement, parameters, context, many):
        if get_ident() != main_thread and "from inventory_items" in statement.lower():
            selected.set()
    event.listen(Engine, "before_cursor_execute", before_select)
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(request)
        assert selected.wait(timeout=10)
        # Both the old lost-update path and the fixed lock path must be blocked
        # by this transaction before it is released.
        with pytest.raises(TimeoutError): future.result(timeout=.25)
        raw_sql.commit()
        return future.result(timeout=10)
    finally:
        raw_sql.rollback()
        pool.shutdown(wait=True)
        event.remove(Engine, "before_cursor_execute", before_select)


def test_direct_adjustment_reads_the_latest_locked_quantity(client, raw_sql, home_a):
    stock = new_stock(client, home_a, quantity=1)
    response = while_stock_is_locked(raw_sql, home_a, stock, lambda: client.post(
        f"{STOCK}/{stock['id']}/adjust", headers=home_a.h, json={"delta": "0.5"}))
    expect_status(response, 200)
    assert Decimal(response.json()["quantity"]) == Decimal("10.5")
    assert Decimal(stock_of(client, home_a)[0]["quantity"]) == Decimal("10.5")


def test_checkout_preserves_a_concurrent_inventory_change(client, raw_sql, home_a):
    stock = new_stock(client, home_a, quantity=1)
    listing = new_list(client, home_a)
    item = new_item(client, home_a, listing["id"], qty=2, inventory_item_id=stock["id"])
    expect_status(check(client, home_a, item["id"]), 200)
    response = while_stock_is_locked(raw_sql, home_a, stock, lambda: complete(
        client, home_a, listing["id"], create_transaction=False))
    expect_status(response, 200)
    assert Decimal(stock_of(client, home_a)[0]["quantity"]) == Decimal("12")
    assert one_list(client, home_a, listing["id"])["items"] == []
    assert txs_of(client, home_a) == []


def test_two_checkouts_lock_shared_stock_in_one_order(client, home_a, monkeypatch):
    from app.services import inventory
    from app.db import financial_lock
    first = new_stock(client, home_a, title="برنج", quantity=1)
    second = new_stock(client, home_a, title="شیر", quantity=2)
    listings = []
    for stocks in [(first, second), (second, first)]:
        listing = new_list(client, home_a)
        for stock in stocks:
            item = new_item(client, home_a, listing["id"], title=stock["title"], qty="0.5", inventory_item_id=stock["id"])
            expect_status(check(client, home_a, item["id"]), 200)
        listings.append(listing)
    gate = Barrier(2)
    original_lock = financial_lock.lock_financial_family
    def together(*args):
        # Synchronize BEFORE the family financial lock. Waiting for a second
        # checkout after acquiring it would deadlock the test's own barrier.
        gate.wait(timeout=10)
        original_lock(*args)
    monkeypatch.setattr(financial_lock, "lock_financial_family", together)
    original_items = inventory.lock_items_uncommitted
    requested_sets = []
    def lock_items(db, family_id, ids):
        requested_sets.append({str(item_id) for item_id in ids})
        original_items(db, family_id, ids)
    monkeypatch.setattr(inventory, "lock_items_uncommitted", lock_items)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(complete, client, home_a, listing["id"], create_transaction=False) for listing in listings]
        for future in futures: expect_status(future.result(timeout=15), 200)
    quantities = {row["id"]: Decimal(row["quantity"]) for row in stock_of(client, home_a)}
    assert quantities[first["id"]] == 2 and quantities[second["id"]] == 3
    assert requested_sets == [{first["id"], second["id"]}] * 2
    assert txs_of(client, home_a) == []


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_inventory_input_never_writes_stock(client, home_a, value):
    stock = new_stock(client, home_a, quantity=1)
    expect_status(client.post(STOCK, headers=home_a.h, json={"title": "نان", "quantity": value}), 422)
    expect_status(client.post(f"{STOCK}/{stock['id']}/adjust", headers=home_a.h, json={"delta": value}), 422)
    assert Decimal(stock_of(client, home_a)[0]["quantity"]) == 1
