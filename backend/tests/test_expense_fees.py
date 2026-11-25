"""Bank-paid expense fees share tariffs and one atomic transaction with their parent."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest

from app.core.errors import AppError
from tests.conftest import API, expect_status
from tests.test_transfer_fees import account, rows


def expense(actor, source, **changes):
    return {"member_id": actor.member_id, "type": "expense", "amount": 1_000_000,
            "category": "food", "date": "2026-11-20", "account_id": source["id"],
            "transfer_fee_method": "card_to_card", **changes}


@pytest.mark.parametrize("method,amount,fee_rial", [
    ("internal", 1_000_000, 0), ("card_to_card", 1_000_000.1, 14_500),
    ("paya", 4_000_500, 4_001), ("satna", 500_250, 1_001), ("pol", 4_000_250, 8_001),
])
def test_expense_fee_uses_exact_rials_and_keeps_the_original_expense(client, home_a, method, amount, fee_rial):
    source = account(client, home_a, balance=amount + fee_rial / 10 + 100)
    body = expense(home_a, source, amount=amount, transfer_fee_method=method, note="خرید تست")
    parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
    assert (parent["type"], parent["amount"], parent["category"], parent["account_id"], parent["note"]) == ("expense", str(amount), "food", source["id"], "خرید تست")
    assert parent["to_account_id"] is None and parent["transfer_fee_rial"] == fee_rial
    expenses = rows(client, home_a)
    if fee_rial == 0:
        assert len(expenses) == 1
        return
    fee = next(row for row in expenses if row["source_kind"] == "transfer_fee")
    assert len(expenses) == 2
    from decimal import Decimal
    from app.schemas.wallet import decimal_text
    assert (fee["amount"], fee["category"], fee["member_id"], fee["account_id"], fee["transfer_fee_for_id"]) == (decimal_text(Decimal(fee_rial) / 10), "finance", home_a.member_id, source["id"], parent["id"])
    assert fee["repeat"] == "none" and fee["note"] is None and not fee["photos"]
    tag = next(row for row in client.get(f"{API}/subcategories", headers=home_a.h).json() if row["id"] == fee["subcategory_id"])
    assert tag["category"] == "finance" and tag["name"] == "کارمزد انتقال"


def test_card_cash_and_legacy_expenses_have_no_automatic_fee(client, home_a):
    bank, cash = account(client, home_a, 5_000_000), account(client, home_a, 5_000_000, "wallet")
    legacy = expense(home_a, bank)
    legacy.pop("transfer_fee_method")
    for body in [legacy, expense(home_a, bank, transfer_fee_method=None), expense(home_a, cash, transfer_fee_method=None)]:
        parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
        assert parent["transfer_fee_method"] is None and parent["transfer_fee_rial"] is None
    assert len(rows(client, home_a)) == 3


def test_update_omission_and_delete_manage_one_linked_fee(client, home_a):
    source, replacement = account(client, home_a), account(client, home_a)
    body = expense(home_a, source)
    parent = expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201).json()
    old_fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    older_client = {key: value for key, value in body.items() if key != "transfer_fee_method"}
    expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json=older_client), 204)
    assert next(row for row in rows(client, home_a) if row["id"] == old_fee["id"]) == old_fee
    changed = {**body, "account_id": replacement["id"], "amount": 500_000, "date": "2026-11-19", "transfer_fee_method": "paya"}
    for _ in range(2):
        expect_status(client.patch(f"{API}/transactions/{parent['id']}", headers=home_a.h, json=changed), 204)
    fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    assert fee["id"] == old_fee["id"] and fee["amount"] == "400" and fee["account_id"] == replacement["id"]
    expect_status(client.patch(f"{API}/transactions/{fee['id']}", headers=home_a.h, json=changed), 422)
    expect_status(client.delete(f"{API}/transactions/{fee['id']}", headers=home_a.h), 422)
    expect_status(client.delete(f"{API}/transactions/{parent['id']}", headers=home_a.h), 204)
    assert not rows(client, home_a)


def test_switching_to_card_or_income_removes_only_the_parent_fee(client, home_a):
    source = account(client, home_a, 5_000_000)
    parents = [expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, source)), 201).json() for _ in range(2)]
    untouched = next(row for row in rows(client, home_a) if row["transfer_fee_for_id"] == parents[1]["id"])
    body = expense(home_a, source, transfer_fee_method=None)
    expect_status(client.patch(f"{API}/transactions/{parents[0]['id']}", headers=home_a.h, json=body), 204)
    assert len(rows(client, home_a)) == 3
    expect_status(client.patch(f"{API}/transactions/{parents[1]['id']}", headers=home_a.h, json={**body, "type": "income", "category": "salary"}), 204)
    assert len(rows(client, home_a)) == 2
    assert not any(row["id"] == untouched["id"] for row in rows(client, home_a))


@pytest.mark.parametrize("changes", [{"transfer_fee_method": "unknown"}, {"transfer_fee_method": "paya_group"},
    {"amount": 0.01}, {"type": "income", "category": "salary"}, {"transfer_fee_rial": 1}, {"source_kind": "transfer_fee"}])
def test_invalid_expense_fee_inputs_create_no_financial_records(client, home_a, changes):
    source = account(client, home_a)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, source, **changes)), 422)
    assert not rows(client, home_a)


def test_combined_balance_and_ownership_are_checked(client, home_a, member_a, home_b):
    underfunded = account(client, home_a, 1_001_099.9)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, underfunded)), 409)
    cash = account(client, home_a, kind="wallet")
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, cash)), 422)
    other = account(client, member_a)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, other)), 403)
    foreign = account(client, home_b)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, foreign)), 422)
    assert not rows(client, home_a)


def test_failure_rolls_back_expense_fee_and_system_tag(client, home_a, monkeypatch):
    from app.services import transactions
    original = transactions._sync_transfer_fee
    def failing_sync(db, parent):
        original(db, parent)
        db.flush()
        raise AppError("TEST_FAILURE", "خطای تست", 409)
    monkeypatch.setattr(transactions, "_sync_transfer_fee", failing_sync)
    source = account(client, home_a)
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=expense(home_a, source)), 409)
    assert not rows(client, home_a)
    assert not client.get(f"{API}/subcategories", headers=home_a.h).json()


def test_simultaneous_expenses_cannot_spend_the_same_fee_funds(client, member_a):
    source = account(client, member_a, 1_001_100)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(f"{API}/transactions", headers=member_a.h, json=expense(member_a, source)), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(rows(client, member_a)) == 2
    assert len([row for row in rows(client, member_a) if row["source_kind"] == "transfer_fee"]) == 1


def test_recurring_payment_gets_its_own_fee_and_keeps_old_payments(client, home_a, monkeypatch):
    from app.services import transactions
    monkeypatch.setattr(transactions, "today_tehran", lambda: date(2026, 11, 20))
    source = account(client, home_a, 5_000_000)
    root = expect_status(client.post(f"{API}/transactions", headers=home_a.h,
        json=expense(home_a, source, date="2026-11-01", repeat="weekly", repeat_end="2027-01-01")), 201).json()
    prior_fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    update = {"amount": 1_000_000.1, "category": "food", "note": "آینده", "start_date": "2026-11-27",
              "repeat": "weekly", "repeat_end": "2027-01-01", "revision": 0}
    expect_status(client.patch(f"{API}/transactions/{root['id']}/recurring", headers=home_a.h, json=update), 200)
    assert next(row for row in rows(client, home_a) if row["id"] == prior_fee["id"]) == prior_fee
    body = {"due_date": "2026-11-27", "revision": 1, "account_id": source["id"]}
    url = f"{API}/transactions/{root['id']}/settle"
    payment = expect_status(client.post(url, headers=home_a.h, json=body), 200).json()
    assert payment["type"] == "expense" and payment["transfer_fee_rial"] == 14_500
    assert expect_status(client.post(url, headers=home_a.h, json=body), 200).json() == payment
    current = rows(client, home_a)
    assert len(current) == 4 and next(row for row in current if row["id"] == prior_fee["id"]) == prior_fee
