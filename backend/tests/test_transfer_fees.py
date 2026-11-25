"""Integer rial tariffs, atomic derived expenses, ownership, and balance precision."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest

from app.core.errors import AppError
from app.services.transfer_fees import calculate_transfer_fee_rial
from tests.conftest import API, expect_status, next_card


@pytest.mark.parametrize("method,amount,count,expected", [
    ("internal", 1, 1, 0), ("card_to_card", 10_000_000, 1, 11_000),
    ("card_to_card", 10_000_001, 1, 14_500), ("card_to_card", 20_000_000, 1, 14_500),
    ("card_to_card", 20_000_001, 1, 18_000),
    ("paya", 1, 1, 4_000), ("paya", 40_005_000, 1, 4_001),
    ("paya", 1_300_000_000, 1, 120_000),
    ("satna", 5_002_499, 1, 1_000), ("satna", 5_002_500, 1, 1_001),
    ("satna", 3_000_000_000, 1, 500_000),
    ("pol", 1, 1, 8_000), ("pol", 40_002_500, 1, 8_001),
    ("paya_group", 1, 3, 31_200),
])
def test_integer_tariff_boundaries(method, amount, count, expected):
    fee = calculate_transfer_fee_rial(method, amount, count)
    assert type(fee) is int and fee == expected


@pytest.mark.parametrize("method,amount,count", [
    ("internal", 0, 1), ("paya", -1, 1), ("paya", True, 1), ("paya", 10.5, 1),
    ("unknown", 1, 1), ("paya_group", 1, 0), ("paya_group", 1, 1.5),
])
def test_invalid_calculator_inputs(method, amount, count):
    with pytest.raises(AppError): calculate_transfer_fee_rial(method, amount, count)


def account(client, actor, balance=2_000_000, kind="bank"):
    return expect_status(client.post(f"{API}/accounts", headers=actor.h, json={
        "member_id": actor.member_id, "title": "حساب تست کارمزد", "kind": kind,
        "bank": "ملی" if kind == "bank" else None, "card_number": next_card() if kind == "bank" else None,
        "initial_balance": balance,
    }), 201).json()


def transfer(actor, source, destination, **fields):
    return {"member_id": actor.member_id, "type": "transfer", "amount": 1_000_000,
        "category": "transfer", "date": "2026-11-19", "account_id": source["id"],
        "to_account_id": destination["id"], "repeat": "none", "transfer_fee_method": "card_to_card", **fields}


def rows(client, actor):
    return expect_status(client.get(f"{API}/transactions", headers=actor.h), 200).json()


def test_fee_is_one_source_expense_update_retry_and_cascade(client, home_a):
    source, destination = account(client, home_a, 1_001_100), account(client, home_a, 0)
    body = transfer(home_a, source, destination)
    parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
    fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    assert parent["transfer_fee_rial"] == 11000
    assert (fee["amount"], fee["category"], fee["account_id"], fee["transfer_fee_for_id"]) == ("1100", "finance", source["id"], parent["id"])
    tag = next(row for row in client.get(f"{API}/subcategories", headers=home_a.h).json() if row["id"] == fee["subcategory_id"])
    assert tag["name"] == "کارمزد انتقال" and tag["category"] == "finance"
    for _ in range(2): expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json=body), 204)
    assert len(rows(client, home_a)) == 2
    # Older-client omission preserves the stored tariff and its expense.
    older = {key: value for key, value in body.items() if key != "transfer_fee_method"}
    expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json=older), 204)
    assert next(row for row in rows(client, home_a) if row["id"] == fee["id"]) == fee
    expect_status(client.patch(f"{API}/transactions/{fee['id']}", headers=home_a.h, json={**body, "type": "expense", "category": "finance"}), 422)
    expect_status(client.delete(f"{API}/transactions/{fee['id']}", headers=home_a.h), 422)
    expect_status(client.delete(f"{API}/transactions/{parent['id']}", headers=home_a.h), 204)
    assert rows(client, home_a) == []


def test_fee_updates_source_date_and_method_and_can_be_removed(client, home_a):
    source, destination, replacement = account(client, home_a), account(client, home_a), account(client, home_a)
    body = transfer(home_a, source, destination)
    parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
    changed = {**body, "amount": 500_000, "account_id": replacement["id"], "date": "2026-11-18", "transfer_fee_method": "paya"}
    expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json=changed), 204)
    fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    assert (fee["amount"], fee["account_id"], fee["date"]) == ("400", replacement["id"], "2026-11-18")
    expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json={**changed, "transfer_fee_method": None}), 204)
    assert len(rows(client, home_a)) == 1 and rows(client, home_a)[0]["transfer_fee_rial"] is None


def test_combined_funds_ownership_cash_and_group_rejections_leave_no_rows(client, home_a, member_a, home_b):
    source, destination = account(client, home_a, 1_001_099.9), account(client, home_a)
    body = transfer(home_a, source, destination)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 409)
    own = account(client, member_a)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=transfer(home_a, own, destination)), 403)
    foreign = account(client, home_b)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=transfer(home_a, source, foreign)), 422)
    cash = account(client, home_a, kind="wallet")
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=transfer(home_a, cash, destination)), 422)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json={**body, "transfer_fee_method": "paya_group"}), 422)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json={**body, "amount": 10.01}), 422)
    assert rows(client, home_a) == []
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=transfer(home_a, cash, destination, transfer_fee_method=None)), 201)
    assert len(rows(client, home_a)) == 1


def test_failure_rolls_back_parent_fee_and_tag(client, home_a, monkeypatch):
    from app.services import transactions
    source, destination = account(client, home_a), account(client, home_a)
    real_sync = transactions._sync_transfer_fee
    def fail(db, parent):
        real_sync(db, parent); db.flush()
        raise AppError("TEST_FAILURE", "خطای تست", 409)
    monkeypatch.setattr(transactions, "_sync_transfer_fee", fail)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=transfer(home_a, source, destination)), 409)
    assert rows(client, home_a) == []
    assert client.get(f"{API}/subcategories", headers=home_a.h).json() == []


def test_minor_can_see_fee_and_fee_counts_in_concurrent_balance_checks(client, home_a, member_a):
    expect_status(client.patch(f"{API}/members/{member_a.member_id}/relation", headers=home_a.h, json={"relation": "فرزند"}), 200)
    source, destination = account(client, member_a, 1_001_100), account(client, member_a)
    body = transfer(member_a, source, destination)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(f"{API}/transactions", headers=member_a.h, json=body), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(rows(client, member_a)) == 2
    assert len([row for row in rows(client, member_a) if row["source_kind"] == "transfer_fee"]) == 1


def test_settlement_keeps_previous_fee_and_is_idempotent(client, home_a, monkeypatch):
    from app.services import transactions
    monkeypatch.setattr(transactions, "today_tehran", lambda: date(2026, 11, 19))
    source, destination = account(client, home_a, 5_000_000), account(client, home_a)
    body = transfer(home_a, source, destination, date="2026-11-01", repeat="weekly", repeat_end="2027-01-01")
    parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
    old_fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    plan = {"amount": 1_000_000.1, "category": "transfer", "note": "آینده", "start_date": "2026-11-26",
        "repeat": "weekly", "repeat_end": "2027-01-01", "revision": 0}
    expect_status(client.patch(f"{API}/transactions/{parent['id']}/recurring", headers=home_a.h, json=plan), 200)
    settlement = {"due_date": "2026-11-26", "revision": 1, "account_id": source["id"], "to_account_id": destination["id"]}
    url = f"{API}/transactions/{parent['id']}/settle"
    paid = expect_status(client.post(url, headers=home_a.h, json=settlement), 200).json()
    assert paid["transfer_fee_rial"] == 14500
    assert expect_status(client.post(url, headers=home_a.h, json=settlement), 200).json() == paid
    now = rows(client, home_a)
    assert len(now) == 4
    assert next(row for row in now if row["id"] == old_fee["id"]) == old_fee


def test_authenticated_quote_and_exact_rial_account_roundtrip(client, home_a):
    expect_status(client.get(f"{API}/transactions/transfer-fee?method=paya&amount_rial=40005000", headers=home_a.h), 200)
    assert client.get(f"{API}/transactions/transfer-fee?method=paya&amount_rial=40005000", headers=home_a.h).json() == {"fee_rial": 4001}
    expect_status(client.get(f"{API}/transactions/transfer-fee?method=paya&amount_rial=1.2", headers=home_a.h), 422)
    expect_status(client.get(f"{API}/transactions/transfer-fee?method=internal&amount_rial=1"), 401)
    row = account(client, home_a, 1499.9, kind="wallet")
    assert row["initial_balance"] == "1499.9"
    expect_status(client.patch(f"{API}/accounts/{row['id']}", headers=home_a.h, json={"title": row["title"], "initial_balance": "1500.1"}), 409)
    expect_status(client.patch(f"{API}/accounts/{row['id']}", headers=home_a.h, json={"title": row["title"], "initial_balance": "1499.9"}), 200)
    saved = next(item for item in client.get(f"{API}/accounts", headers=home_a.h).json() if item["id"] == row["id"])
    assert saved["initial_balance"] == "1499.9"
