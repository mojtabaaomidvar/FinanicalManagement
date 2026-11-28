"""Wallet reads enforce role and family boundaries, while transfers remain possible."""
from __future__ import annotations

import pytest

from tests.conftest import API, AUTH, add_active_member, expect_status, login_as, make_account, make_holding


@pytest.fixture(params=("owner", "admin"))
def wallet_manager(request, client, home_a):
    if request.param == "owner":
        return home_a
    member = add_active_member(client, home_a, "Wallet administrator")
    expect_status(client.post(f"{AUTH}/members/{member.member_id}/promote", headers=home_a.h), 200)
    return login_as(client, member.phone)


def test_member_account_reads_hide_other_owners_even_with_forged_filters(client, home_a, member_a, home_b):
    own = make_account(client, member_a, "Own wallet", "wallet")
    make_account(client, home_a, "Private owner wallet", "wallet")
    make_account(client, home_b, "Other family wallet", "wallet")
    make_account(client, home_a, "Private owner bank")
    for suffix in ("", f"?member_id={home_a.member_id}", f"?family_id={home_b.family_id}", "?role=admin", "?view=wallets"):
        rows = expect_status(client.get(f"{API}/accounts{suffix}", headers=member_a.h), 200).json()
        assert {row["id"] for row in rows} == {own}
    expect_status(client.get(f"{API}/accounts?view=all", headers=member_a.h), 422)


def test_member_with_no_accounts_receives_an_empty_list(client, home_a, member_a):
    make_account(client, home_a)
    assert expect_status(client.get(f"{API}/accounts", headers=member_a.h), 200).json() == []


def test_managers_read_all_and_only_their_family_accounts(client, member_a, home_b, wallet_manager):
    own = make_account(client, wallet_manager, "Manager wallet", "wallet")
    member_wallet = make_account(client, member_a, "Member wallet", "wallet")
    member_bank = make_account(client, member_a, "Member bank")
    make_account(client, home_b, "Other family", "wallet")
    rows = expect_status(client.get(f"{API}/accounts?family_id={home_b.family_id}", headers=wallet_manager.h), 200).json()
    assert {row["id"] for row in rows} == {own, member_wallet, member_bank}


def test_transfer_targets_expose_only_routing_metadata_and_preserve_member_transfers(client, home_a, member_a, home_b):
    source = expect_status(client.post(f"{API}/accounts", headers=member_a.h, json={
        "member_id": member_a.member_id, "title": "Private source", "kind": "wallet", "initial_balance": "1000",
    }), 201).json()
    destination = make_account(client, home_a, "Private destination", "wallet")
    make_account(client, home_b, "Other family", "wallet")
    targets = expect_status(client.get(f"{API}/accounts?view=transfer-targets&family_id={home_b.family_id}", headers=member_a.h), 200).json()
    assert {row["id"] for row in targets} == {source["id"], destination}
    assert all(set(row) == {"id", "family_id", "member_id", "kind"} for row in targets)
    saved = expect_status(client.post(f"{API}/transactions", headers=member_a.h, json={
        "member_id": member_a.member_id, "type": "transfer", "amount": "100", "category": "transfer",
        "date": "2026-11-27", "account_id": source["id"], "to_account_id": destination,
    }), 201).json()
    assert saved["account_id"] == source["id"] and saved["to_account_id"] == destination
    assert {row["id"] for row in client.get(f"{API}/accounts", headers=member_a.h).json()} == {source["id"]}


def test_holdings_and_their_aggregate_are_scoped_before_pricing(client, member_a, home_b, wallet_manager, monkeypatch):
    from app.services import holdings, market

    monkeypatch.setattr(holdings.market_service, "price_lookup", lambda kinds: ({market.price_key("gold", "IR_GOLD_18K"): (10.0, "تومان")}, False))
    own = make_holding(client, member_a)
    manager_holding = make_holding(client, wallet_manager)
    make_holding(client, home_b)
    personal = expect_status(client.get(f"{API}/holdings", headers=member_a.h), 200).json()
    assert {row["id"] for row in personal["items"]} == {own}
    assert personal["total"] == 20
    family = expect_status(client.get(f"{API}/holdings", headers=wallet_manager.h), 200).json()
    assert {row["id"] for row in family["items"]} == {own, manager_holding}
    assert family["total"] == 40


def test_existing_admin_session_loses_family_wallet_access_after_demotion(client, home_a, member_a):
    make_account(client, home_a, "Owner wallet", "wallet")
    own = make_account(client, member_a, "Member wallet", "wallet")
    expect_status(client.post(f"{AUTH}/members/{member_a.member_id}/promote", headers=home_a.h), 200)
    assert len(client.get(f"{API}/accounts", headers=member_a.h).json()) == 2
    expect_status(client.post(f"{AUTH}/members/{member_a.member_id}/demote", headers=home_a.h), 200)
    assert {row["id"] for row in client.get(f"{API}/accounts", headers=member_a.h).json()} == {own}


def test_wallet_reads_require_authentication(client):
    for path in ("/accounts", "/accounts?view=transfer-targets", "/holdings"):
        expect_status(client.get(f"{API}{path}"), 401)
