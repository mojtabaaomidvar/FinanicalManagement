"""Real PostgreSQL wallet precision, immutable receipts and competing corrections."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import uuid4

import pytest

from tests.conftest import API, expect_status, add_active_member
from tests.test_finance_account_recurring import wallet, rows, transaction


def balance(client, actor, account):
    return expect_status(client.get(f"{API}/accounts/{account['id']}/balance", headers=actor.h), 200).json()


def correct(client, actor, account, target, mode="reconciliation", **extra):
    body = {"operation_id": str(uuid4()), "base_revision": balance(client, actor, account)["revision"],
            "target_balance": target, "mode": mode, "description": "بررسی موجودی واقعی", **extra}
    return client.post(f"{API}/accounts/{account['id']}/corrections", headers=actor.h, json=body), body


def history(client, actor, account):
    return expect_status(client.get(f"{API}/accounts/{account['id']}/corrections", headers=actor.h), 200).json()


def test_exact_transport_and_live_reconciliation_without_new_transactions(client, home_a):
    account = wallet(client, home_a, "1499.9")
    assert account["initial_balance"] == "1499.9"
    before = rows(client, home_a)
    response, _ = correct(client, home_a, account, "1400.01")
    receipt = expect_status(response, 201).json()
    assert receipt["target_balance"] == "1400.01" and receipt["transaction_id"] is None
    assert rows(client, home_a) == before
    tx = transaction(client, home_a, amount="0.11", account_id=account["id"], repeat="none")
    assert tx["amount"] == "0.11"
    result = balance(client, home_a, account)
    assert result["ledger_balance"] == "1499.79" and result["current_balance"] == "1399.9"
    assert history(client, home_a, account)[0] == receipt


def test_ledger_correction_retires_anchor_and_replay_never_applies_twice(client, home_a):
    account = wallet(client, home_a, "1000")
    expect_status(correct(client, home_a, account, "900")[0], 201)
    response, request = correct(client, home_a, account, "800", "ledger")
    receipt = expect_status(response, 201).json()
    assert receipt["delta"] == "-200" and receipt["transaction_id"]
    state = balance(client, home_a, account)
    assert state["ledger_balance"] == state["current_balance"] == "800"
    assert state["active_reconciliation_id"] is None
    url = f"{API}/accounts/{account['id']}/corrections"
    assert expect_status(client.post(url, headers=home_a.h, json=request), 201).json() == receipt
    assert len(rows(client, home_a)) == 1 and len(history(client, home_a, account)) == 2
    assert expect_status(client.post(url, headers=home_a.h, json={**request, "target_balance": "700"}), 409).json()["error"] == "OPERATION_CONFLICT"
    expect_status(client.delete(f"{API}/transactions/{receipt['transaction_id']}", headers=home_a.h), 422)
    assert balance(client, home_a, account) == state


def test_second_reconciliation_replaces_anchor_and_edit_delete_advance_revision(client, home_a):
    account = wallet(client, home_a, "1000")
    first = expect_status(correct(client, home_a, account, "900")[0], 201).json()
    second = expect_status(correct(client, home_a, account, "850")[0], 201).json()
    assert balance(client, home_a, account)["current_balance"] == "850"
    tx = transaction(client, home_a, amount="100", account_id=account["id"], repeat="none")
    old = balance(client, home_a, account)
    assert old["current_balance"] == "750"
    body = {"member_id": home_a.member_id, "type": "expense", "amount": "50", "category": "food", "date": "2026-10-01", "account_id": account["id"]}
    expect_status(client.patch(f"{API}/transactions/{tx['id']}", headers=home_a.h, json=body), 204)
    edited = balance(client, home_a, account)
    assert edited["current_balance"] == "800" and edited["revision"] > old["revision"]
    expect_status(client.delete(f"{API}/transactions/{tx['id']}", headers=home_a.h), 204)
    assert balance(client, home_a, account)["current_balance"] == "850"
    assert history(client, home_a, account) == [second, first]


def test_zero_delta_receipt_clears_anchor_without_zero_transaction(client, home_a):
    account = wallet(client, home_a, "1000")
    expect_status(correct(client, home_a, account, "900")[0], 201)
    result = expect_status(correct(client, home_a, account, "1000", "ledger")[0], 201).json()
    assert result["delta"] == "0" and result["transaction_id"] is None
    assert rows(client, home_a) == [] and balance(client, home_a, account)["current_balance"] == "1000"


def test_stale_preview_and_two_distinct_operations_cannot_both_apply(client, home_a):
    account = wallet(client, home_a, "1000")
    request = {"operation_id": str(uuid4()), "base_revision": balance(client, home_a, account)["revision"], "target_balance": "900", "mode": "ledger"}
    url = f"{API}/accounts/{account['id']}/corrections"
    bodies = [request, {**request, "operation_id": str(uuid4()), "target_balance": "800"}]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: client.post(url, headers=home_a.h, json=body), bodies))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(rows(client, home_a)) == 1 and len(history(client, home_a, account)) == 1


def test_correction_history_and_receipts_are_owner_scoped(client, home_a, member_a, home_b):
    account = wallet(client, member_a)
    receipt = expect_status(correct(client, member_a, account, "12.3")[0], 201).json()
    expect_status(client.get(f"{API}/accounts/{account['id']}/balance", headers=home_a.h), 200)
    expect_status(client.get(f"{API}/accounts/{account['id']}/corrections", headers=home_a.h), 200)
    request = {"operation_id": str(uuid4()), "base_revision": 0, "target_balance": "1", "mode": "ledger"}
    for actor in [home_a, home_b]:
        expect_status(client.post(f"{API}/accounts/{account['id']}/corrections", headers=actor.h, json=request), 404)
    expect_status(client.get(f"{API}/accounts/{account['id']}/balance", headers=home_b.h), 404)
    expect_status(client.get(f"{API}/accounts/{account['id']}/corrections/{receipt['operation_id']}", headers=home_b.h), 404)
    expect_status(client.request("DELETE", f"{API}/accounts/{account['id']}", headers=member_a.h, json={"confirmation": account["title"]}), 409)


def test_failed_commit_rolls_back_adjustment_anchor_and_receipt(client, home_a, monkeypatch):
    from app.services import wallet_corrections
    account = wallet(client, home_a, "1000")
    expect_status(correct(client, home_a, account, "900")[0], 201)
    before = balance(client, home_a, account)
    original = wallet_corrections.commit_correction
    def fail(db):
        db.flush()
        raise RuntimeError("injected before commit")
    monkeypatch.setattr(wallet_corrections, "commit_correction", fail)
    with pytest.raises(RuntimeError):
        correct(client, home_a, account, "800", "ledger")
    monkeypatch.setattr(wallet_corrections, "commit_correction", original)
    assert balance(client, home_a, account) == before
    assert rows(client, home_a) == [] and len(history(client, home_a, account)) == 1


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "1.001", "-1000000000000000"])
def test_invalid_target_never_becomes_a_rounded_correction(client, home_a, amount):
    account = wallet(client, home_a)
    expect_status(correct(client, home_a, account, amount)[0], 422)
    assert history(client, home_a, account) == []


def test_large_opening_balance_and_one_rial_delta_remain_exact(client, home_a):
    account = wallet(client, home_a, "999999999999999")
    response, _ = correct(client, home_a, account, "999999999999998.9", "ledger")
    receipt = expect_status(response, 201).json()
    assert Decimal(receipt["delta"]) == Decimal("-0.1")
    assert balance(client, home_a, account)["current_balance"] == "999999999999998.9"


def test_read_history_is_denied_to_another_ordinary_member_and_id_collision_rolls_back(client, home_a, member_a):
    from tests.conftest import Actor
    other = add_active_member(client, home_a, "هم‌خانه")
    # add_active_member returns an authenticated Actor in the shared test helpers.
    assert isinstance(other, Actor)
    account = wallet(client, member_a, "1000")
    receipt = expect_status(correct(client, member_a, account, "900")[0], 201).json()
    expect_status(client.get(f"{API}/accounts/{account['id']}/corrections", headers=other.h), 404)
    own = wallet(client, other, "1000")
    response, _ = correct(client, other, own, "800", "ledger", operation_id=receipt["operation_id"])
    expect_status(response, 409)
    assert balance(client, other, own)["current_balance"] == "1000"
    assert rows(client, other) == []


def test_raw_sql_receipts_fail_closed_and_cannot_modify_generated_adjustment(client, home_a, member_a, raw_sql):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    account = wallet(client, member_a, "1000")
    receipt = expect_status(correct(client, member_a, account, "900", "ledger")[0], 201).json()
    assert raw_sql.scalar(text("SELECT count(*) FROM wallet_corrections")) == 0
    raw_sql.execute(text("SELECT set_config('app.family_id', :fid, true)"), {"fid": member_a.family_id})
    raw_sql.execute(text("SELECT set_config('app.document_member_id', :mid, true)"), {"mid": member_a.member_id})
    assert raw_sql.scalar(text("SELECT count(*) FROM wallet_corrections")) == 1
    raw_sql.execute(text("SELECT set_config('app.document_member_id', :mid, true)"), {"mid": home_a.member_id})
    assert raw_sql.scalar(text("SELECT count(*) FROM wallet_corrections")) == 1  # family manager
    # No member context is required for the immutable source guard.
    raw_sql.execute(text("SELECT set_config('app.document_member_id', '', true)"))
    with pytest.raises(IntegrityError), raw_sql.begin_nested():
        raw_sql.execute(text("UPDATE transactions SET amount=1 WHERE id=:id"), {"id": receipt["transaction_id"]})
    raw_sql.rollback()
    assert balance(client, member_a, account)["current_balance"] == "900"


def test_available_funds_use_active_reconciliation_not_uncorrected_ledger(client, home_a):
    account = wallet(client, home_a, "1000")
    expect_status(correct(client, home_a, account, "100")[0], 201)
    body = {"member_id": home_a.member_id, "type": "expense", "amount": "100.1", "category": "food",
            "date": "2026-11-19", "account_id": account["id"], "require_available_balance": True}
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 409)
    body["amount"] = "100"
    expect_status(client.post(f"{API}/transactions", headers=home_a.h, json=body), 201)
    assert balance(client, home_a, account)["current_balance"] == "0"
    assert balance(client, home_a, account)["ledger_balance"] == "900"


def test_metadata_edit_preserves_opening_and_reconciliation(client, home_a):
    account = wallet(client, home_a, "1499.9")
    expect_status(correct(client, home_a, account, "1400.01")[0], 201)
    before = balance(client, home_a, account)
    expect_status(client.patch(f"{API}/accounts/{account['id']}", headers=home_a.h,
                  json={"title": "عنوان تازه", "initial_balance": "1499.9"}), 200)
    assert balance(client, home_a, account) == before
    expect_status(client.patch(f"{API}/accounts/{account['id']}", headers=home_a.h,
                  json={"title": "عنوان تازه", "initial_balance": "1500"}), 409)
    assert balance(client, home_a, account) == before


def test_oversized_delta_is_not_split_into_multiple_transactions(client, home_a):
    account = wallet(client, home_a, "1000000000000")
    before = balance(client, home_a, account)
    expect_status(correct(client, home_a, account, "0", "ledger")[0], 422)
    assert balance(client, home_a, account) == before
    assert rows(client, home_a) == [] and history(client, home_a, account) == []


def test_transfer_and_derived_fee_advance_both_wallets_once(client, home_a):
    from tests.test_transfer_fees import account as bank_account, transfer
    source, destination = bank_account(client, home_a, "2000000"), bank_account(client, home_a, "0")
    expect_status(correct(client, home_a, source, "1500000")[0], 201)
    expect_status(correct(client, home_a, destination, "100")[0], 201)
    prior = balance(client, home_a, source)
    tx = expect_status(client.post(f"{API}/transactions", headers=home_a.h,
                       json=transfer(home_a, source, destination)), 201).json()
    after = balance(client, home_a, source)
    assert after["current_balance"] == "498900" and after["ledger_balance"] == "998900"
    assert balance(client, home_a, destination)["current_balance"] == "1000100"
    assert after["revision"] > prior["revision"]
    expect_status(client.delete(f"{API}/transactions/{tx['id']}", headers=home_a.h), 204)
    assert balance(client, home_a, source)["current_balance"] == "1500000"
    assert balance(client, home_a, destination)["current_balance"] == "100"


@pytest.mark.parametrize("writer", ["manual", "actorless", "bill", "shopping", "recurring"])
def test_generated_writers_invalidate_a_previously_reviewed_correction(client, home_a, writer):
    from uuid import UUID
    from app.db.session import SessionLocal
    from app.db.rls import bind_family_to_session
    from app.schemas.data import TransactionWrite
    from app.services import transactions
    account = wallet(client, home_a, "1000")
    request = {"operation_id": str(uuid4()), "base_revision": balance(client, home_a, account)["revision"],
               "target_balance": "900", "mode": "reconciliation"}
    if writer == "manual":
        transaction(client, home_a, account_id=account["id"], amount="10", repeat="none")
    elif writer == "actorless":
        with SessionLocal() as db:
            bind_family_to_session(db, home_a.family_id)
            transactions.create(db, UUID(home_a.family_id), TransactionWrite(member_id=home_a.member_id,
                                type="expense", amount=Decimal("10"), category="food", date="2026-11-19", account_id=account["id"]))
    elif writer == "bill":
        from tests.test_bills import new_bill
        bill = new_bill(client, home_a, amount="10")
        expect_status(client.post(f"{API}/bills/{bill['id']}/pay", headers=home_a.h,
                                  json={"account_id": account["id"]}), 200)
    elif writer == "shopping":
        from tests.test_shopping import new_list, new_item, check, complete
        shopping_list = new_list(client, home_a)
        item = new_item(client, home_a, shopping_list["id"], price="10")
        expect_status(check(client, home_a, item["id"]), 200)
        expect_status(complete(client, home_a, shopping_list["id"], account_id=account["id"]), 200)
    else:
        recurring = transaction(client, home_a, account_id=account["id"], amount="10", date="2026-11-01", repeat="weekly", repeat_end="2027-01-01")
        request["base_revision"] = balance(client, home_a, account)["revision"]
        expect_status(client.post(f"{API}/transactions/{recurring['id']}/settle", headers=home_a.h,
                      json={"due_date": "2026-11-08", "revision": 0, "account_id": account["id"]}), 200)
    expect_status(client.post(f"{API}/accounts/{account['id']}/corrections", headers=home_a.h, json=request), 409)
    assert history(client, home_a, account) == []


def test_positive_adjustment_preserves_previous_rows_date_and_full_supported_note(client, home_a):
    account = wallet(client, home_a, "1000")
    original = transaction(client, home_a, amount="0.11", account_id=account["id"], repeat="none", date="2026-10-01")
    expect_status(correct(client, home_a, account, "500")[0], 201)
    note = "شرح دقیق " + "ا" * 180
    receipt = expect_status(correct(client, home_a, account, "1000.01", "ledger", description=note)[0], 201).json()
    assert receipt["delta"] == "0.12" and receipt["description"] == note
    adjustment = next(row for row in rows(client, home_a) if row["id"] == receipt["transaction_id"])
    assert adjustment["amount"] == "0.12" and adjustment["type"] == "income"
    assert adjustment["category"] == "adjust-i" and adjustment["note"] == note
    from app.services.member_age import today_tehran
    assert adjustment["date"] == today_tehran().isoformat()
    assert adjustment["source_kind"] == "wallet_correction" and adjustment["repeat"] == "none"
    assert next(row for row in rows(client, home_a) if row["id"] == original["id"]) == original
    assert balance(client, home_a, account)["current_balance"] == "1000.01"
    expect_status(correct(client, home_a, account, "900", "ledger", description="الف" * 201)[0], 422)


def test_amount_only_ledger_includes_protected_sources_without_revealing_details(client, home_a, member_a, raw_sql):
    from datetime import date
    from uuid import UUID
    from sqlalchemy import text
    from app.db.session import SessionLocal
    from app.db.rls import bind_family_to_session
    from app.db.document_scope import bind_member
    from app.schemas.data import TransactionWrite
    from app.services import transactions
    account = wallet(client, member_a, "1000")
    with SessionLocal() as db:
        bind_family_to_session(db, home_a.family_id)
        bind_member(db, home_a.member_id)
        protected = transactions.create_uncommitted(db, UUID(home_a.family_id), TransactionWrite(
            member_id=member_a.member_id, type="expense", amount=Decimal("25.01"), category="transport",
            date=date(2026, 11, 19), account_id=account["id"], note="شرح محافظت‌شده"), source_kind="vehicle_service")
        protected_id = str(protected.id)
        db.commit()
    assert all(row["id"] != protected_id for row in rows(client, member_a))
    assert balance(client, member_a, account)["ledger_balance"] == "974.99"
    receipt = expect_status(correct(client, member_a, account, "900", "ledger")[0], 201).json()
    assert receipt["delta"] == "-74.99" and "شرح محافظت‌شده" not in str(history(client, member_a, account))
    assert balance(client, member_a, account)["ledger_balance"] == "900"
    # The SECURITY DEFINER projection cannot read a foreign account or run publicly.
    assert raw_sql.scalar(text("SELECT public.wallet_ledger_balance(:id,NULL)"), {"id": account["id"]}) is None
    raw_sql.execute(text("SELECT set_config('app.family_id',:fid,true), set_config('app.document_member_id',:mid,true)"),
                    {"fid": home_a.family_id, "mid": home_a.member_id})
    assert raw_sql.scalar(text("SELECT public.wallet_ledger_balance(:id,NULL)"), {"id": account["id"]}) == Decimal("900")
    assert raw_sql.scalar(text("SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a "
                              "WHERE p.proname='wallet_ledger_balance' AND a.grantee=0 AND a.privilege_type='EXECUTE'")) == 0


def test_deferred_database_guard_rejects_unreceipted_correction_and_bad_link(client, home_a, raw_sql):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    account = wallet(client, home_a, "1000")
    ordinary = transaction(client, home_a, amount="10", account_id=account["id"], repeat="none")
    raw_sql.execute(text("SELECT set_config('app.family_id',:fid,true), set_config('app.document_member_id',:mid,true)"),
                    {"fid": home_a.family_id, "mid": home_a.member_id})
    raw_sql.execute(text("UPDATE transactions SET source_kind='wallet_correction', category='adjust-e' WHERE id=:id"),
                    {"id": ordinary["id"]})
    with pytest.raises(IntegrityError):
        raw_sql.commit()
    raw_sql.rollback()
    assert rows(client, home_a)[0] == ordinary
    assert history(client, home_a, account) == []


def raw_reconciliation(raw_sql, actor, account, state, **changes):
    from sqlalchemy import text
    values = {
        "family_id": actor.family_id, "account_id": account["id"], "created_by": actor.member_id,
        "operation_id": str(uuid4()), "request_hash": "0" * 64, "mode": "reconciliation",
        "revision": state["revision"] + 1, "target_balance": "900",
        "ledger_before": state["ledger_balance"], "current_before": state["current_balance"],
        "ledger_after": state["ledger_balance"], "current_after": "900",
        "delta": str(Decimal("900") - Decimal(state["current_balance"])), "transaction_id": None,
        **changes,
    }
    raw_sql.execute(text("SELECT set_config('app.family_id',:fid,true), set_config('app.document_member_id',:mid,true)"),
                    {"fid": actor.family_id, "mid": actor.member_id})
    columns = ",".join(values)
    parameters = ",".join(":" + column for column in values)
    raw_sql.execute(text(f"INSERT INTO wallet_corrections ({columns}) VALUES ({parameters})"), values)


def test_database_maintains_receipt_revision_and_rejects_stale_api_preview(client, home_a, raw_sql):
    account = wallet(client, home_a, "1000")
    state = balance(client, home_a, account)
    raw_reconciliation(raw_sql, home_a, account, state)
    raw_sql.commit()
    after = balance(client, home_a, account)
    assert after["revision"] == state["revision"] + 1 and after["current_balance"] == "900"
    assert rows(client, home_a) == []
    expect_status(correct(client, home_a, account, "850", base_revision=state["revision"])[0], 409)
    assert balance(client, home_a, account) == after


@pytest.mark.parametrize("changes", [
    {"revision": 0}, {"revision": 20},
    {"ledger_before": "1001", "ledger_after": "1001"},
    {"current_before": "1001", "delta": "-101"},
    {"current_after": "901"}, {"delta": "-99"},
])
def test_database_rejects_forged_or_stale_snapshots_atomically(client, home_a, raw_sql, changes):
    from sqlalchemy.exc import IntegrityError
    account = wallet(client, home_a, "1000")
    state = balance(client, home_a, account)
    with pytest.raises(IntegrityError):
        raw_reconciliation(raw_sql, home_a, account, state, **changes)
        raw_sql.commit()
    raw_sql.rollback()
    assert balance(client, home_a, account) == state
    assert history(client, home_a, account) == [] and rows(client, home_a) == []


def test_protected_source_prevents_wallet_deletion_without_revealing_details(client, home_a, member_a):
    from uuid import UUID
    from app.db.session import SessionLocal
    from app.db.rls import bind_family_to_session
    from app.db.document_scope import bind_member
    from app.schemas.data import TransactionWrite
    from app.services import transactions
    account = wallet(client, member_a, "1000")
    with SessionLocal() as db:
        bind_family_to_session(db, home_a.family_id)
        bind_member(db, home_a.member_id)
        protected = transactions.create_uncommitted(db, UUID(home_a.family_id), TransactionWrite(
            member_id=member_a.member_id, type="expense", amount=Decimal("25.01"), category="transport",
            date="2026-11-19", account_id=account["id"], note="شرح محافظت‌شده"), source_kind="vehicle_service")
        protected_id = str(protected.id)
        db.commit()
    assert rows(client, member_a) == []
    state = balance(client, member_a, account)
    response = expect_status(client.request("DELETE", f"{API}/accounts/{account['id']}", headers=member_a.h,
                            json={"confirmation": account["title"]}), 409)
    assert response.json()["error"] == "ACCOUNT_IN_USE" and "شرح محافظت‌شده" not in response.text
    assert balance(client, member_a, account) == state
    assert next(row for row in rows(client, home_a) if row["id"] == protected_id)["account_id"] == account["id"]


def test_inactive_reader_cannot_read_amount_projection_or_audit_receipts(client, home_a, raw_sql):
    from sqlalchemy import text
    account = wallet(client, home_a, "1000")
    expect_status(correct(client, home_a, account, "900")[0], 201)
    raw_sql.execute(text("SELECT set_config('app.family_id',:fid,true), set_config('app.document_member_id',:mid,true)"),
                    {"fid": home_a.family_id, "mid": home_a.member_id})
    raw_sql.execute(text("UPDATE members SET membership_state='suspended' WHERE id=:id"), {"id": home_a.member_id})
    assert raw_sql.scalar(text("SELECT public.wallet_ledger_balance(:aid,NULL)"), {"aid": account["id"]}) is None
    assert raw_sql.scalar(text("SELECT public.wallet_account_has_transactions(:aid)"), {"aid": account["id"]}) is None
    assert raw_sql.scalar(text("SELECT count(*) FROM wallet_corrections")) == 0
    raw_sql.rollback()


@pytest.mark.parametrize("first", ["correction", "delete"])
def test_wallet_deletion_serializes_with_an_audited_correction(client, home_a, monkeypatch, first):
    from threading import Event
    from app.db import financial_lock
    from app.services import accounts, wallet_corrections
    account = wallet(client, home_a, "1000")
    state = balance(client, home_a, account)
    holding, competing = Event(), Event()
    leading_session = None
    original = financial_lock.lock_financial_family
    def interleave(db, family_id):
        nonlocal leading_session
        if leading_session is None: leading_session = db
        elif db is not leading_session: competing.set()
        original(db, family_id)
        if db is leading_session and not holding.is_set():
            holding.set()
            assert competing.wait(10)
    monkeypatch.setattr(accounts, "lock_financial_family", interleave)
    monkeypatch.setattr(wallet_corrections, "lock_financial_family", interleave)
    def run_correction():
        return client.post(f"{API}/accounts/{account['id']}/corrections", headers=home_a.h, json={
            "operation_id": str(uuid4()), "base_revision": state["revision"], "target_balance": "900", "mode": "reconciliation"})
    def run_delete():
        return client.request("DELETE", f"{API}/accounts/{account['id']}", headers=home_a.h, json={"confirmation": account["title"]})
    with ThreadPoolExecutor(max_workers=2) as pool:
        leader = pool.submit(run_correction if first == "correction" else run_delete)
        assert holding.wait(10)
        follower = pool.submit(run_delete if first == "correction" else run_correction)
        leader_result, follower_result = leader.result(timeout=20), follower.result(timeout=20)
    assert (leader_result.status_code, follower_result.status_code) == ((201, 409) if first == "correction" else (204, 404))
    if first == "correction":
        assert balance(client, home_a, account)["current_balance"] == "900"
        assert len(history(client, home_a, account)) == 1
    else:
        assert all(row["id"] != account["id"] for row in client.get(f"{API}/accounts", headers=home_a.h).json())


def prepare_writer(client, actor, account, writer):
    """Set up first; return one real application write and its signed ledger effect."""
    body = {"member_id": actor.member_id, "type": "expense", "amount": "10", "category": "food",
            "date": "2026-11-19", "account_id": account["id"], "repeat": "none"}
    if writer == "manual":
        return lambda: expect_status(client.post(f"{API}/transactions", headers=actor.h, json=body), 201), "-10"
    if writer == "actorless":
        def run():
            from uuid import UUID
            from app.db.session import SessionLocal
            from app.db.rls import bind_family_to_session
            from app.schemas.data import TransactionWrite
            from app.services import transactions
            with SessionLocal() as db:
                bind_family_to_session(db, actor.family_id)
                transactions.create(db, UUID(actor.family_id), TransactionWrite(**body))
        return run, "-10"
    if writer in ("edit", "delete", "move"):
        original = transaction(client, actor, **{key: value for key, value in body.items() if key != "member_id"})
        if writer == "delete":
            return lambda: expect_status(client.delete(f"{API}/transactions/{original['id']}", headers=actor.h), 204), "10"
        destination = wallet(client, actor, "1000") if writer == "move" else account
        body.update(account_id=destination["id"], amount="10" if writer == "move" else "4")
        return lambda: expect_status(client.patch(f"{API}/transactions/{original['id']}", headers=actor.h, json=body), 204), "10" if writer == "move" else "6"
    if writer == "bill":
        from tests.test_bills import new_bill
        bill = new_bill(client, actor, amount="10")
        return lambda: expect_status(client.post(f"{API}/bills/{bill['id']}/pay", headers=actor.h,
                            json={"account_id": account["id"]}), 200), "-10"
    if writer == "shopping":
        from tests.test_shopping import new_list, new_item, check, complete
        shopping_list = new_list(client, actor)
        item = new_item(client, actor, shopping_list["id"], price="10")
        expect_status(check(client, actor, item["id"]), 200)
        return lambda: expect_status(complete(client, actor, shopping_list["id"], account_id=account["id"]), 200), "-10"
    if writer == "recurring":
        recurring = transaction(client, actor, amount="10", account_id=account["id"], date="2026-11-01")
        return lambda: expect_status(client.post(f"{API}/transactions/{recurring['id']}/settle", headers=actor.h,
                        json={"due_date": "2026-11-08", "revision": 0, "account_id": account["id"]}), 200), "-10"
    if writer == "sms":
        from tests.test_sms_integrity import import_sms, record, payment
        sms = import_sms(client, actor)
        return lambda: expect_status(record(client, actor, sms["id"], payment(actor, account["id"])), 200), "-25000"
    if writer == "vehicle":
        from tests.test_vehicles import create_vehicle, add_service, service_body
        vehicle = create_vehicle(client, actor)
        return lambda: expect_status(add_service(client, actor, vehicle,
                       service_body(vehicle, cost_amount="10", account_id=account["id"])), 200), "-10"
    from tests.test_transfer_fees import account as bank_account, transfer
    destination = bank_account(client, actor, "0")
    return lambda: expect_status(client.post(f"{API}/transactions", headers=actor.h,
                                 json=transfer(actor, account, destination)), 201), "-1001100"


@pytest.mark.parametrize("writer", ["manual", "actorless", "edit", "delete", "move", "transfer", "bill", "shopping", "recurring", "sms", "vehicle"])
@pytest.mark.parametrize("first", ["correction", "writer"])
def test_each_financial_writer_serializes_with_a_competing_correction(client, home_a, monkeypatch, writer, first):
    from threading import Event
    from app.db import financial_lock
    from app.services import transactions, wallet_corrections
    from tests.test_transfer_fees import account as bank_account
    account = bank_account(client, home_a, "10000000") if writer == "transfer" else wallet(client, home_a, "10000000")
    run_writer, effect = prepare_writer(client, home_a, account, writer)
    before = balance(client, home_a, account)
    request = {"operation_id": str(uuid4()), "base_revision": before["revision"], "target_balance": "9000000", "mode": "reconciliation"}
    holding, competing = Event(), Event()
    second_session = None
    original_lock = financial_lock.lock_financial_family
    first_session = None
    def interleaved_lock(db, family_id):
        nonlocal first_session, second_session
        if first_session is None:
            first_session = db
        elif db is not first_session:
            second_session = db
            competing.set()  # The second write is about to wait on the real DB lock.
        original_lock(db, family_id)
        if db is first_session and not holding.is_set():
            holding.set()
            assert competing.wait(10), "competing operation did not reach its financial lock"
    monkeypatch.setattr(financial_lock, "lock_financial_family", interleaved_lock)
    monkeypatch.setattr(transactions, "lock_financial_family", interleaved_lock)
    monkeypatch.setattr(wallet_corrections, "lock_financial_family", interleaved_lock)
    def run_correction():
        return client.post(f"{API}/accounts/{account['id']}/corrections", headers=home_a.h, json=request)
    with ThreadPoolExecutor(max_workers=2) as pool:
        leader = pool.submit(run_correction if first == "correction" else run_writer)
        assert holding.wait(10), "first operation did not acquire the financial lock"
        follower = pool.submit(run_writer if first == "correction" else run_correction)
        leader_result, follower_result = leader.result(timeout=20), follower.result(timeout=20)
    assert second_session is not None
    response = leader_result if first == "correction" else follower_result
    expect_status(response, 201 if first == "correction" else 409)
    after = balance(client, home_a, account)
    assert Decimal(after["ledger_balance"]) == Decimal(before["ledger_balance"]) + Decimal(effect)
    assert Decimal(after["current_balance"]) == (Decimal("9000000") if first == "correction" else Decimal(before["current_balance"])) + Decimal(effect)
    if first == "correction":
        assert history(client, home_a, account)[0] == response.json()
    else:
        assert history(client, home_a, account) == []
