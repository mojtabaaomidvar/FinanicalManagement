"""Explicit online/card choice, linked fee lifecycle, and additive history safety."""
from alembic import command
from alembic.config import Config
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from sqlalchemy import text
import pytest

from tests.conftest import API, BACKEND_DIR, MIGRATION_URL, expect_status
from tests.test_transfer_fees import account, rows
from tests.test_sms_integrity import import_sms, payment, record


@pytest.mark.parametrize("method", ["card", "online"])
def test_no_fee_payment_roundtrip_and_older_edit_preserves_choice(client, home_a, method):
    bank = account(client, home_a)
    fields = payment(home_a, bank["id"], payment_method=method, transfer_fee_method=None)
    parent = expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 201).json()
    assert parent["payment_method"] == method and parent["transfer_fee_rial"] is None
    assert len(rows(client, home_a)) == 1
    older = {key: value for key, value in fields.items() if key not in ("payment_method", "transfer_fee_method")}
    expect_status(client.patch(API + f'/transactions/{parent["id"]}', headers=home_a.h, json={**older, "note": "keep choice"}), 204)
    assert rows(client, home_a)[0]["payment_method"] == method
    expect_status(client.patch(API + f'/transactions/{parent["id"]}', headers=home_a.h,
                              json={**fields, "transfer_fee_method": "paya"}), 422)
    assert len(rows(client, home_a)) == 1 and rows(client, home_a)[0]["transfer_fee_rial"] is None


def test_switch_transfer_expense_to_online_removes_only_linked_fee(client, home_a):
    bank = account(client, home_a)
    fields = payment(home_a, bank["id"], payment_method="bank_transfer", transfer_fee_method="paya", note="my payment")
    parent = expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 201).json()
    original_fee = next(row for row in rows(client, home_a) if row["source_kind"] == "transfer_fee")
    assert original_fee["transfer_fee_for_id"] == parent["id"] and original_fee["amount"] == "400"
    for method in ["online", "card"]:
        expect_status(client.patch(API + f'/transactions/{parent["id"]}', headers=home_a.h,
                                  json={**fields, "payment_method": method, "transfer_fee_method": None}), 204)
        now = rows(client, home_a)
        assert len(now) == 1 and now[0]["id"] == parent["id"]
        assert now[0]["payment_method"] == method and now[0]["note"] == "my payment"
    expect_status(client.patch(API + f'/transactions/{parent["id"]}', headers=home_a.h, json=fields), 204)
    assert len(rows(client, home_a)) == 2
    expect_status(client.delete(API + f'/transactions/{parent["id"]}', headers=home_a.h), 204)
    assert rows(client, home_a) == []


@pytest.mark.parametrize("method", ["card", "online", "bank_transfer"])
def test_sms_atomic_payment_choice_and_retry(client, home_a, method):
    bank = account(client, home_a)
    sms = import_sms(client, home_a)
    fields = payment(home_a, bank["id"], payment_method=method,
                     transfer_fee_method="paya" if method == "bank_transfer" else None)
    parent = expect_status(record(client, home_a, sms["id"], fields), 200).json()
    assert parent["payment_method"] == method
    assert expect_status(record(client, home_a, sms["id"], fields), 200).json() == parent
    assert len(rows(client, home_a)) == (2 if method == "bank_transfer" else 1)


@pytest.mark.parametrize("changes", [{"payment_method": "unknown"}, {"payment_method": "online", "type": "income", "category": "salary"},
                                     {"payment_method": "online", "transfer_fee_method": "internal"}])
def test_invalid_methods_and_online_fee_are_rejected_before_any_write(client, home_a, changes):
    bank = account(client, home_a)
    fields = payment(home_a, bank["id"], **changes)
    expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 422)
    sms = import_sms(client, home_a)
    expect_status(record(client, home_a, sms["id"], fields), 422)
    assert rows(client, home_a) == []
    assert client.get(API + "/sms?status=pending", headers=home_a.h).json()[0]["transaction_id"] is None


def test_payment_method_migration_does_not_invent_choices_or_rewrite_old_fees(client, home_a, database):
    bank = account(client, home_a)
    parent = expect_status(client.post(API + "/transactions", headers=home_a.h,
        json=payment(home_a, bank["id"], transfer_fee_method="paya", note="historical note")), 201).json()
    before = rows(client, home_a)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = MIGRATION_URL.render_as_string(hide_password=False)
    try:
        command.downgrade(cfg, "0035_sms_integrity")
        command.upgrade(cfg, "head")
    finally:
        command.upgrade(cfg, "head")
        from tests.conftest import grant_test_application_access
        grant_test_application_access(database)
    assert rows(client, home_a) == before
    assert next(row for row in before if row["id"] == parent["id"])["payment_method"] is None
    with database.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM transactions WHERE payment_method IS NOT NULL")).scalar() == 0


@pytest.mark.parametrize("method", ["online", "bank_transfer"])
def test_simultaneous_sms_retries_link_one_payment_and_one_optional_fee(client, home_a, method):
    bank = account(client, home_a)
    sms = import_sms(client, home_a)
    fields = payment(home_a, bank["id"], payment_method=method,
                     transfer_fee_method="paya" if method == "bank_transfer" else None)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: record(client, home_a, sms["id"], fields), range(2)))
    receipts = [expect_status(response, 200).json() for response in responses]
    assert receipts[0] == receipts[1] and receipts[0]["payment_method"] == method
    assert len(rows(client, home_a)) == (2 if method == "bank_transfer" else 1)


@pytest.mark.parametrize("method", ["card", "online", "bank_transfer"])
def test_recurring_settlement_preserves_method_and_prior_financial_rows(client, home_a, monkeypatch, method):
    from app.services import transactions
    monkeypatch.setattr(transactions, "today_tehran", lambda: date(2026, 11, 19))
    bank = account(client, home_a)
    fields = payment(home_a, bank["id"], payment_method=method,
        transfer_fee_method="paya" if method == "bank_transfer" else None,
        date="2026-11-01", repeat="weekly", repeat_end="2027-01-01")
    parent = expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 201).json()
    before = rows(client, home_a)
    url = API + f'/transactions/{parent["id"]}/settle'
    payload = {"due_date": "2026-11-08", "revision": 0, "account_id": bank["id"]}
    paid = expect_status(client.post(url, headers=home_a.h, json=payload), 200).json()
    assert paid["payment_method"] == method
    assert paid["transfer_fee_rial"] == (4000 if method == "bank_transfer" else None)
    assert expect_status(client.post(url, headers=home_a.h, json=payload), 200).json() == paid
    after = rows(client, home_a)
    assert len(after) == len(before) * 2
    for old in before:
        now = next(row for row in after if row["id"] == old["id"])
        assert {key: value for key, value in now.items() if key != "handled_occurrences"} == {
            key: value for key, value in old.items() if key != "handled_occurrences"}
