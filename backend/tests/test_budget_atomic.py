from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from sqlalchemy import text

from .conftest import API, AUTH


def cap(client, actor):
    return Decimal(str(client.get(f"{AUTH}/family", headers=actor.h).json()["budget"]))


def budgets(client, actor):
    return {
        row["category"]: row
        for row in client.get(f"{API}/category-budgets", headers=actor.h).json()
    }


def setup(client, actor):
    assert (
        client.patch(f"{API}/family/settings", headers=actor.h, json={"budget": 100}).status_code
        == 204
    )
    assert (
        client.post(
            f"{API}/category-budgets", headers=actor.h, json={"category": "food", "amount": 40}
        ).status_code
        == 200
    )


def proposal(amount=150):
    return {
        "category": "food",
        "amount": amount,
        "monthly_cap": amount,
        "expected_amount": 40,
        "expected_monthly_cap": 100,
        "expected_budget_total": 40,
    }


def test_cap_and_category_are_saved_together_and_retry_keeps_one_record(client, home_a):
    setup(client, home_a)
    original_id = budgets(client, home_a)["food"]["id"]
    for _ in range(2):
        result = client.post(f"{API}/category-budgets", headers=home_a.h, json=proposal())
        assert result.status_code == 200, result.text
    assert cap(client, home_a) == 150
    rows = budgets(client, home_a)
    assert len(rows) == 1 and rows["food"]["id"] == original_id
    assert Decimal(str(rows["food"]["amount"])) == 150


def test_failure_after_family_flush_rolls_back_both_values(client, home_a, database):
    from fastapi.testclient import TestClient

    from app.main import app

    setup(client, home_a)
    with database.begin() as db:
        db.execute(
            text(
                "CREATE FUNCTION test_budget_failure() RETURNS trigger LANGUAGE plpgsql "
                "AS $$ BEGIN RAISE EXCEPTION 'test budget failure'; END; $$"
            )
        )
        db.execute(
            text(
                "CREATE TRIGGER test_budget_failure BEFORE INSERT OR UPDATE ON category_budgets "
                "FOR EACH ROW EXECUTE FUNCTION test_budget_failure()"
            )
        )
    try:
        with TestClient(app, raise_server_exceptions=False) as failing:
            result = failing.post(f"{API}/category-budgets", headers=home_a.h, json=proposal())
            assert result.status_code == 500
        assert cap(client, home_a) == 100
        assert Decimal(str(budgets(client, home_a)["food"]["amount"])) == 40
    finally:
        with database.begin() as db:
            db.execute(text("DROP TRIGGER test_budget_failure ON category_budgets"))
            db.execute(text("DROP FUNCTION test_budget_failure()"))


@pytest.mark.parametrize(
    "field,value",
    [("expected_amount", 0), ("expected_monthly_cap", 0), ("expected_budget_total", 0)],
)
def test_stale_expectations_change_neither_value(client, home_a, field, value):
    setup(client, home_a)
    body = proposal()
    body[field] = value
    result = client.post(f"{API}/category-budgets", headers=home_a.h, json=body)
    assert result.status_code == 409
    assert cap(client, home_a) == 100
    assert Decimal(str(budgets(client, home_a)["food"]["amount"])) == 40


def test_concurrent_proposals_have_one_winner(client, home_a):
    setup(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda amount: client.post(
                    f"{API}/category-budgets", headers=home_a.h, json=proposal(amount)
                ),
                [150, 200],
            )
        )
    assert sorted(row.status_code for row in results) == [200, 409]
    assert cap(client, home_a) == Decimal(str(budgets(client, home_a)["food"]["amount"]))


def test_member_cannot_change_family_cap_or_category(client, home_a, member_a):
    setup(client, home_a)
    assert (
        client.post(f"{API}/category-budgets", headers=member_a.h, json=proposal()).status_code
        == 403
    )
    assert (
        client.patch(f"{API}/family/settings", headers=member_a.h, json={"budget": 150}).status_code
        == 403
    )
    assert cap(client, home_a) == 100


def test_second_admin_can_use_the_same_atomic_write(client, home_a, member_a, database):
    setup(client, home_a)
    with database.begin() as db:
        db.execute(
            text("UPDATE members SET role='admin' WHERE id=CAST(:id AS uuid)"),
            {"id": member_a.member_id},
        )
    assert (
        client.post(f"{API}/category-budgets", headers=member_a.h, json=proposal()).status_code
        == 200
    )
    assert cap(client, home_a) == 150


def test_cap_overflow_and_stale_delete_preserve_budget_and_transactions(client, home_a):
    setup(client, home_a)
    body = proposal()
    del body["monthly_cap"]
    assert client.post(f"{API}/category-budgets", headers=home_a.h, json=body).status_code == 409
    before = client.get(f"{API}/transactions", headers=home_a.h).json()
    assert (
        client.delete(
            f"{API}/category-budgets/food?expected_amount=50", headers=home_a.h
        ).status_code
        == 409
    )
    assert (
        client.delete(
            f"{API}/category-budgets/food?expected_amount=40", headers=home_a.h
        ).status_code
        == 204
    )
    assert cap(client, home_a) == 100
    assert client.get(f"{API}/transactions", headers=home_a.h).json() == before


def test_stale_monthly_cap_does_not_overwrite_another_manager(client, home_a):
    setup(client, home_a)
    result = client.patch(
        f"{API}/family/settings",
        headers=home_a.h,
        json={"budget": 120, "expected_budget": 100, "expected_budget_total": 0},
    )
    assert result.status_code == 409
    assert cap(client, home_a) == 100


def test_other_family_records_are_not_changed(client, home_a, home_b):
    setup(client, home_a)
    result = client.post(
        f"{API}/category-budgets",
        headers=home_b.h,
        json={"category": "food", "amount": 20, "family_id": home_a.family_id},
    )
    assert result.status_code == 200
    assert cap(client, home_a) == 100
    assert Decimal(str(budgets(client, home_a)["food"]["amount"])) == 40
