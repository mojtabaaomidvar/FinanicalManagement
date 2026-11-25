"""Account ownership, protected deletion, and atomic future occurrence settlement."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date

import jdatetime
import pytest

from tests.conftest import API, add_active_member, expect_status, make_subcategory, next_card


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    from app.services import transactions

    monkeypatch.setattr(transactions, "today_tehran", lambda: date(2026, 11, 19))


def wallet(client, actor, balance=500000):
    return expect_status(
        client.post(
            f"{API}/accounts",
            headers=actor.h,
            json={
                "member_id": actor.member_id,
                "title": "نقد",
                "kind": "wallet",
                "initial_balance": balance,
            },
        ),
        201,
    ).json()


def transaction(client, actor, **fields):
    return expect_status(
        client.post(
            f"{API}/transactions",
            headers=actor.h,
            json={
                "member_id": actor.member_id,
                "type": "expense",
                "amount": 10000,
                "category": "food",
                "date": "2026-11-01",
                "note": "اصل ثبت‌شده",
                "repeat": "weekly",
                "repeat_end": "2027-01-01",
                **fields,
            },
        ),
        201,
    ).json()


def rows(client, actor):
    return expect_status(client.get(f"{API}/transactions", headers=actor.h), 200).json()


def settle(client, actor, tx, **fields):
    return client.post(
        f"{API}/transactions/{tx['id']}/settle",
        headers=actor.h,
        json={
            "due_date": "2026-11-08",
            "revision": 0,
            **fields,
        },
    )


def edit_plan(client, actor, tx, **fields):
    return client.patch(
        f"{API}/transactions/{tx['id']}/recurring",
        headers=actor.h,
        json={
            "amount": 20000,
            "category": "home",
            "note": "آینده",
            "start_date": "2026-11-26",
            "repeat": "weekly",
            "repeat_end": "2027-02-01",
            "revision": 0,
            **fields,
        },
    )


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_manager_cannot_change_or_delete_another_account(client, home_a, member_a, role):
    from tests.conftest import AUTH, login_as

    manager = home_a
    if role == "admin":
        manager = add_active_member(client, home_a, "مدیر دوم")
        expect_status(
            client.post(f"{AUTH}/members/{manager.member_id}/promote", headers=home_a.h), 200
        )
        manager = login_as(client, manager.phone)
    account = wallet(client, member_a)
    expect_status(
        client.patch(
            f"{API}/accounts/{account['id']}", headers=manager.h, json={"title": "تغییر مدیر"}
        ),
        404,
    )
    expect_status(
        client.request(
            "DELETE",
            f"{API}/accounts/{account['id']}",
            headers=manager.h,
            json={"confirmation": account["title"]},
        ),
        404,
    )
    accounts = client.get(f"{API}/accounts", headers=member_a.h).json()
    assert next(row for row in accounts if row["id"] == account["id"]) == account


def test_manager_adds_only_bank_account_for_child(client, home_a, member_a, home_b):
    expect_status(
        client.patch(
            f"{API}/members/{member_a.member_id}/relation",
            headers=home_a.h,
            json={"relation": "همسر"},
        ),
        200,
    )
    child = add_active_member(client, home_a, "فرزند")
    expect_status(
        client.patch(
            f"{API}/members/{child.member_id}/relation",
            headers=home_a.h,
            json={"relation": "فرزند"},
        ),
        200,
    )
    body = {
        "member_id": child.member_id,
        "title": "کارت فرزند",
        "kind": "bank",
        "card_number": next_card(),
    }
    child_account = expect_status(
        client.post(f"{API}/accounts", headers=home_a.h, json=body), 201
    ).json()
    expect_status(
        client.patch(
            f"{API}/accounts/{child_account['id']}", headers=home_a.h, json={"title": "دستکاری"}
        ),
        404,
    )
    for target, kind, status in [
        (member_a.member_id, "bank", 403),
        (home_b.member_id, "bank", 422),
        (child.member_id, "wallet", 403),
    ]:
        expect_status(
            client.post(
                f"{API}/accounts",
                headers=home_a.h,
                json={**body, "member_id": target, "kind": kind},
            ),
            status,
        )
    expect_status(client.post(f"{API}/accounts", headers=member_a.h, json=body), 403)


def test_card_removal_change_and_typed_delete_require_confirmation(client, home_a):
    body = {
        "member_id": home_a.member_id,
        "title": "کارت",
        "kind": "bank",
        "card_number": next_card(),
    }
    account = expect_status(client.post(f"{API}/accounts", headers=home_a.h, json=body), 201).json()
    url = f"{API}/accounts/{account['id']}"
    patch = {"title": "کارت", "card_number": next_card()}
    assert (
        expect_status(client.patch(url, headers=home_a.h, json=patch), 422).json()["error"]
        == "ACCOUNT_CONFIRMATION_REQUIRED"
    )
    expect_status(
        client.patch(url, headers=home_a.h, json={**patch, "confirm_card_change": True}), 200
    )
    assert (
        expect_status(
            client.patch(
                url, headers=home_a.h, json={"title": "کارت", "confirm_card_change": True}
            ),
            422,
        ).json()["error"]
        == "EMPTY_ACCOUNT"
    )
    for body in [None, {"confirmation": "اشتباه"}, {"confirmation": " کارت"}]:
        expect_status(client.request("DELETE", url, headers=home_a.h, json=body), 422)
    expect_status(
        client.request("DELETE", url, headers=home_a.h, json={"confirmation": "کارت"}), 204
    )


@pytest.mark.parametrize("destination", [False, True])
def test_account_history_blocks_delete_without_losing_ledger(client, home_a, destination):
    account = wallet(client, home_a)
    source = wallet(client, home_a)
    tx = transaction(
        client,
        home_a,
        repeat="none",
        account_id=source["id"] if destination else account["id"],
        type="transfer" if destination else "expense",
        category="transfer" if destination else "food",
        to_account_id=account["id"] if destination else None,
    )
    response = client.request(
        "DELETE",
        f"{API}/accounts/{account['id']}",
        headers=home_a.h,
        json={"confirmation": account["title"]},
    )
    assert expect_status(response, 409).json()["error"] == "ACCOUNT_IN_USE"
    assert next(row for row in rows(client, home_a) if row["id"] == tx["id"]) == tx


def test_future_edit_preserves_original_and_paid_transaction_then_settles_early(client, home_a):
    account = wallet(client, home_a)
    tx = transaction(
        client, home_a, account_id=account["id"], subcategory_id=make_subcategory(client, home_a)
    )
    paid = expect_status(settle(client, home_a, tx, account_id=account["id"]), 200).json()
    changed = expect_status(edit_plan(client, home_a, tx), 200).json()
    for field in [
        "amount",
        "category",
        "date",
        "time",
        "note",
        "account_id",
        "subcategory_id",
        "created_at",
    ]:
        assert changed[field] == tx[field]
    assert next(row for row in rows(client, home_a) if row["id"] == paid["id"]) == paid
    assert changed["recurring_plan"] == {
        "amount": "20000",
        "category": "home",
        "note": "آینده",
        "start_date": "2026-11-26",
        "revision": 1,
    }
    early = expect_status(
        settle(
            client, home_a, changed, due_date="2026-11-26", revision=1, account_id=account["id"]
        ),
        200,
    ).json()
    assert (
        early["amount"],
        early["category"],
        early["note"],
        early["date"],
        early["repeat"],
        early["subcategory_id"],
    ) == ("20000", "home", "آینده", "2026-11-19", "none", None)
    assert early["recurring_due_date"] == "2026-11-26" and early["recurring_source_id"] == tx["id"]
    # Even an old revision retry resolves to the same committed payment.
    assert (
        expect_status(
            settle(client, home_a, changed, due_date="2026-11-26", revision=0), 200
        ).json()
        == early
    )
    assert (
        expect_status(
            client.delete(f"{API}/transactions/{tx['id']}", headers=home_a.h), 409
        ).json()["error"]
        == "RECURRING_HISTORY_EXISTS"
    )


def test_concurrent_settlement_creates_one_payment(client, home_a):
    account = wallet(client, home_a)
    tx = transaction(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: settle(client, home_a, tx, account_id=account["id"]), range(2))
        )
    ids = [expect_status(response, 200).json()["id"] for response in responses]
    assert ids[0] == ids[1]
    assert len([row for row in rows(client, home_a) if row["recurring_source_id"] == tx["id"]]) == 1


def test_revision_permissions_funds_and_manual_later_occurrence(client, home_a, member_a, home_b):
    tx = transaction(client, member_a)
    own = wallet(client, member_a, 5000)
    foreign = wallet(client, home_a)
    expect_status(settle(client, home_a, tx, account_id=foreign["id"]), 200)
    expect_status(settle(client, home_b, tx), 404)
    expect_status(edit_plan(client, home_a, tx, revision=9), 409)
    changed = expect_status(edit_plan(client, member_a, tx), 200).json()
    expect_status(
        settle(
            client, member_a, changed, due_date="2026-11-26", revision=1, account_id=foreign["id"]
        ),
        403,
    )
    expect_status(
        settle(client, member_a, changed, due_date="2026-11-26", revision=1, account_id=own["id"]),
        409,
    )
    expect_status(settle(client, member_a, changed, due_date="2026-12-03", revision=1), 409)
    manual = {
        "member_id": member_a.member_id,
        "type": "expense",
        "amount": 1000,
        "category": "home",
        "date": "2026-11-19",
        "repeat": "none",
        "account_id": own["id"],
    }
    expect_status(
        settle(client, member_a, changed, due_date="2026-12-03", revision=1, transaction=manual),
        200,
    )
    expect_status(edit_plan(client, home_b, tx, revision=1), 404)
    other = transaction(client, home_a)
    expect_status(edit_plan(client, member_a, other), 404)


@pytest.mark.parametrize(
    "repeat,start,expected",
    [
        ("monthly", (1405, 6, 31), [(1405, 7, 30), (1405, 8, 30)]),
        ("yearly", (1403, 12, 30), [(1404, 12, 29), (1405, 12, 29)]),
    ],
)
def test_schedule_clamps_in_jalali_without_day_drift(repeat, start, expected):
    from types import SimpleNamespace

    from app.services.transactions import _schedule_dates

    row = SimpleNamespace(
        date=jdatetime.date(*start).togregorian(),
        recurring_start_date=None,
        repeat=repeat,
        repeat_end=jdatetime.date(*expected[-1]).togregorian(),
    )
    assert list(_schedule_dates(row)) == [
        jdatetime.date(*parts).togregorian() for parts in expected
    ]


def test_transaction_endpoint_checks_owner_and_fresh_available_balance(client, home_a, member_a):
    account = wallet(client, member_a, 5000)
    body = {
        "member_id": home_a.member_id,
        "type": "expense",
        "amount": 1000,
        "category": "food",
        "date": "2026-11-19",
        "account_id": account["id"],
        "require_available_balance": True,
    }
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 403)
    body["member_id"] = member_a.member_id
    expect_status(
        client.post(f"{API}/transactions", headers=member_a.h, json={**body, "account_id": None}),
        422,
    )
    expect_status(
        client.post(f"{API}/transactions", headers=member_a.h, json={**body, "amount": 5001}), 409
    )
    expect_status(
        client.post(f"{API}/transactions", headers=member_a.h, json={**body, "amount": 5000}), 201
    )
    expect_status(client.post(f"{API}/transactions", headers=member_a.h, json=body), 409)
