"""Vehicle permission, mileage and Finance atomicity on the real PostgreSQL boundary."""

from __future__ import annotations

import hashlib
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import (
    API,
    AUTH,
    add_active_member,
    expect_status,
    make_account,
    make_transaction,
)
from tests.test_documents import create_doc
from tests.test_documents import update as update_doc

VEHICLES = f"{API}/vehicles"
_INPUT_FIELDS = (
    "title",
    "brand",
    "model",
    "plate",
    "purchase_date",
    "odometer",
    "insurance_until",
    "inspection_until",
    "document_id",
    "service_task_id",
    "service_due_date",
    "service_due_odometer",
    "service_reminder_enabled",
)
_TX_FIELDS = (
    "member_id",
    "type",
    "amount",
    "category",
    "date",
    "time",
    "note",
    "account_id",
    "to_account_id",
    "subcategory_id",
    "repeat",
    "repeat_end",
)


def adult(client, owner, name="بزرگسال"):
    actor = add_active_member(client, owner, name)
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=owner.h, json={"relation": "سایر"}
        ),
        200,
    )
    return actor


def create_vehicle(client, actor, **fields):
    return expect_status(
        client.post(VEHICLES, headers=actor.h, json={"title": "خودرو", **fields}), 201
    ).json()


def listed(client, actor):
    return expect_status(client.get(VEHICLES, headers=actor.h), 200).json()


def current(client, actor, item):
    return next(row for row in listed(client, actor)["vehicles"] if row["id"] == item["id"])


def edit(client, actor, item, **fields):
    return client.patch(
        f"{VEHICLES}/{item['id']}",
        headers=actor.h,
        json={
            **{key: item[key] for key in _INPUT_FIELDS},
            "base_revision": item["revision"],
            **fields,
        },
    )


def remove(client, actor, item):
    return client.delete(
        f"{VEHICLES}/{item['id']}", headers=actor.h, params={"base_revision": item["revision"]}
    )


def service_body(item, **fields):
    return {
        "operation_id": str(uuid.uuid4()),
        "base_revision": item["revision"],
        "performed_on": "2026-11-14",
        "description": "تعویض روغن",
        "performed_odometer": item["odometer"],
        "next_due_date": None,
        "next_due_odometer": None,
        **fields,
    }


def add_service(client, actor, item, body=None):
    return client.post(
        f"{VEHICLES}/{item['id']}/services", headers=actor.h, json=body or service_body(item)
    )


def history(client, actor, item):
    return expect_status(
        client.get(f"{VEHICLES}/{item['id']}/services", headers=actor.h), 200
    ).json()


def finance(client, actor):
    return expect_status(client.get(f"{API}/transactions", headers=actor.h), 200).json()


def edit_expense(client, actor, expense, **fields):
    return client.patch(
        f"{API}/transactions/{expense['id']}",
        headers=actor.h,
        json={**{key: expense[key] for key in _TX_FIELDS}, **fields},
    )


def scope(conn, actor, member_id=None):
    conn.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": actor.family_id, "mid": member_id or ""},
    )


def seed_source_photo(conn, actor, expense_id):
    """Synthetic metadata exercises inherited guards without uploading or creating a file."""
    scope(conn, actor, actor.member_id)
    photo_id = conn.execute(
        text(
            "INSERT INTO transaction_photos (family_id,transaction_id,member_id,url) "
            "VALUES (:fid,:tid,:mid,'urn:test:vehicle-service-photo') RETURNING id"
        ),
        {"fid": actor.family_id, "tid": expense_id, "mid": actor.member_id},
    ).scalar_one()
    conn.commit()
    return {"id": str(photo_id)}


def test_vehicle_crud_normalization_projection_and_noop_revision(client, home_a):
    item = create_vehicle(
        client,
        home_a,
        title="  خودروی   خانواده ",
        brand=" برند ",
        model=" ",
        plate=" ۱۲۳ ",
        odometer=12500,
        purchase_date="2026-01-01",
        insurance_until="2027-01-01",
        inspection_until="2027-02-01",
    )
    assert item["title"] == "خودروی خانواده" and item["brand"] == "برند"
    assert item["model"] is None and item["plate"] == "۱۲۳" and item["odometer"] == 12500
    assert item["can_edit"] and item["can_delete"] and item["can_view_history"]
    assert item["created_by"] == home_a.member_id and item["revision"] == 1
    assert "family_id" not in item
    assert listed(client, home_a) == {"vehicles": [item], "can_create": True}
    item = expect_status(edit(client, home_a, item), 200).json()
    assert item["revision"] == 2
    expect_status(remove(client, home_a, item), 204)
    assert listed(client, home_a)["vehicles"] == []


def test_creator_adult_admin_and_shared_history_permissions(client, home_a):
    creator = adult(client, home_a, "سازنده")
    other = adult(client, home_a, "عضو دیگر")
    admin = adult(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    item = create_vehicle(client, creator)
    projection = current(client, other, item)
    assert not projection["can_edit"] and not projection["can_delete"]
    assert projection["can_view_history"]
    expect_status(edit(client, other, item), 403)
    expect_status(remove(client, other, item), 403)
    expect_status(add_service(client, other, item), 403)
    item = expect_status(edit(client, creator, item), 200).json()
    completed = expect_status(add_service(client, admin, item), 200).json()
    assert history(client, other, item) == [completed["record"]]
    item = expect_status(edit(client, home_a, completed["vehicle"]), 200).json()
    expect_status(remove(client, admin, item), 204)


@pytest.mark.parametrize("promote", [False, True])
def test_child_receives_basic_schedule_but_sensitive_fields_and_actions_are_denied(
    client,
    home_a,
    promote,
):
    child = add_active_member(client, home_a)
    if promote:
        expect_status(
            client.post(f"{AUTH}/members/{child.member_id}/promote", headers=home_a.h), 200
        )
    doc = create_doc(client, home_a, visibility="shared")
    item = create_vehicle(
        client,
        home_a,
        plate="پلاک حساس",
        insurance_until="2027-01-01",
        inspection_until="2027-02-01",
        document_id=doc["id"],
        odometer=100,
        service_due_date="2027-03-01",
        service_due_odometer=200,
    )
    expect_status(add_service(client, home_a, item), 200)
    view = listed(client, child)
    assert not view["can_create"]
    projection = view["vehicles"][0]
    for key in ("plate", "insurance_until", "inspection_until", "document_id"):
        assert projection[key] is None
    for key in ("can_edit", "can_delete", "can_view_history"):
        assert projection[key] is False
    assert projection["title"] == item["title"] and projection["odometer"] == 100
    expect_status(client.post(VEHICLES, headers=child.h, json={"title": "غیرمجاز"}), 403)
    expect_status(edit(client, child, projection), 403)
    expect_status(remove(client, child, projection), 403)
    expect_status(add_service(client, child, projection), 403)
    expect_status(client.get(f"{VEHICLES}/{item['id']}/services", headers=child.h), 403)


def test_self_profile_correction_cannot_promote_protected_vehicle_access(client, home_a):
    child = add_active_member(client, home_a)
    item = create_vehicle(client, home_a, plate="حساس")
    expect_status(
        client.patch(
            f"{API}/members/me",
            headers=child.h,
            json={"name": "نام تازه", "birth_date": "2000-01-01"},
        ),
        200,
    )
    assert current(client, child, item)["plate"] is None
    expect_status(client.post(VEHICLES, headers=child.h, json={"title": "خودرو"}), 403)
    expect_status(client.post(f"{AUTH}/members/{child.member_id}/promote", headers=home_a.h), 200)
    expect_status(
        client.patch(
            f"{API}/members/{child.member_id}/relation", headers=child.h, json={"relation": "سایر"}
        ),
        200,
    )
    assert current(client, child, item)["can_edit"] is False
    expect_status(
        client.patch(
            f"{API}/members/{child.member_id}/relation", headers=home_a.h, json={"relation": "سایر"}
        ),
        200,
    )
    assert current(client, child, item)["can_edit"] is True


def test_foreign_family_vehicles_services_and_links_are_inaccessible(client, home_a, home_b):
    item = create_vehicle(client, home_a)
    expect_status(add_service(client, home_a, item), 200)
    assert listed(client, home_b)["vehicles"] == []
    expect_status(edit(client, home_b, item), 404)
    expect_status(remove(client, home_b, item), 404)
    expect_status(add_service(client, home_b, item), 404)
    expect_status(client.get(f"{VEHICLES}/{item['id']}/services", headers=home_b.h), 404)
    foreign_doc = create_doc(client, home_b, visibility="shared")
    expect_status(
        client.post(
            VEHICLES, headers=home_a.h, json={"title": "خودرو", "document_id": foreign_doc["id"]}
        ),
        404,
    )


def test_documents_require_shared_visibility_and_current_links_clear_on_deletion(
    client,
    home_a,
):
    shared = create_doc(client, home_a, visibility="shared")
    private = create_doc(client, home_a)
    task = expect_status(
        client.post(f"{API}/tasks", headers=home_a.h, json={"title": "سرویس خودرو"}), 201
    ).json()
    item = create_vehicle(client, home_a, document_id=shared["id"], service_task_id=task["id"])
    expect_status(edit(client, home_a, item, document_id=private["id"]), 404)
    private_shared = expect_status(
        update_doc(client, home_a, shared, visibility="private"), 200
    ).json()
    assert current(client, home_a, item)["document_id"] is None
    expect_status(
        client.delete(
            f"{API}/documents/{shared['id']}",
            headers=home_a.h,
            params={"base_revision": private_shared["revision"]},
        ),
        204,
    )
    expect_status(
        client.delete(
            f"{API}/tasks/{task['id']}",
            headers=home_a.h,
            params={"base_revision": task["revision"]},
        ),
        204,
    )
    item = current(client, home_a, item)
    assert item["document_id"] is None and item["service_task_id"] is None
    assert item["revision"] >= 3


def test_service_updates_mileage_and_replaces_both_schedule_fields_atomically(client, home_a):
    item = create_vehicle(
        client, home_a, odometer=10000, service_due_date="2026-11-15", service_due_odometer=10100
    )
    body = service_body(
        item,
        performed_odometer=10500,
        next_due_date="2027-01-01",
        next_due_odometer=15000,
        description="  تعویض روغن  ",
    )
    result = expect_status(add_service(client, home_a, item, body), 200).json()
    assert not result["replayed"] and result["vehicle"]["revision"] == 2
    assert result["vehicle"]["odometer"] == 10500
    assert result["vehicle"]["service_due_date"] == "2027-01-01"
    assert result["vehicle"]["service_due_odometer"] == 15000
    assert result["record"]["description"] == "تعویض روغن"
    assert result["record"]["cost_status"] == "none"
    assert result["record"]["cost_amount"] is None and result["record"]["transaction_id"] is None
    replay = expect_status(add_service(client, home_a, item, body), 200).json()
    assert replay["replayed"] and replay["vehicle"] == result["vehicle"]
    assert replay["record"] == result["record"] and len(history(client, home_a, item)) == 1
    cleared = expect_status(add_service(client, home_a, result["vehicle"]), 200).json()["vehicle"]
    assert cleared["service_due_date"] is None and cleared["service_due_odometer"] is None
    assert cleared["service_reminder_enabled"] is True and finance(client, home_a) == []


def test_decreasing_mileage_and_stale_revision_cannot_change_vehicle_or_history(client, home_a):
    item = create_vehicle(client, home_a, odometer=100)
    expect_status(edit(client, home_a, item, odometer=99), 422)
    expect_status(add_service(client, home_a, item, service_body(item, performed_odometer=99)), 422)
    assert current(client, home_a, item) == item and history(client, home_a, item) == []
    newer = expect_status(edit(client, home_a, item, odometer=200), 200).json()
    expect_status(edit(client, home_a, item, odometer=300), 409)
    expect_status(remove(client, home_a, item), 409)
    expect_status(
        add_service(client, home_a, item, service_body(item, performed_odometer=300)), 409
    )
    assert current(client, home_a, item) == newer and history(client, home_a, item) == []


def test_service_cost_is_one_finance_expense_with_server_owned_origin(client, home_a):
    account = make_account(client, home_a)
    item = create_vehicle(client, home_a, odometer=100)
    body = service_body(
        item,
        performed_odometer=200,
        cost_amount="1250000.25",
        account_id=account,
        description="الف" * 300,
    )
    result = expect_status(add_service(client, home_a, item, body), 200).json()
    expense = finance(client, home_a)[0]
    assert expense["id"] == result["record"]["transaction_id"]
    assert expense["type"] == "expense" and expense["category"] == "transport"
    assert expense["source_kind"] == "vehicle_service" and expense["member_id"] == home_a.member_id
    assert expense["date"] == body["performed_on"] and expense["repeat"] == "none"
    assert expense["repeat_end"] is None and expense["account_id"] == account
    assert expense["amount"] == "1250000.25" and len(expense["note"]) == 200
    assert len(result["record"]["description"]) == 900
    assert result["record"]["cost_amount"] == "1250000.25"
    assert result["record"]["cost_status"] == "recorded"
    replay = expect_status(add_service(client, home_a, item, body), 200).json()
    assert replay["replayed"] and len(finance(client, home_a)) == 1
    assert len(history(client, home_a, item)) == 1


@pytest.mark.parametrize("foreign", [False, True])
def test_invalid_account_rolls_back_expense_schedule_mileage_and_record(
    client, home_a, home_b, foreign
):
    account = make_account(client, home_b) if foreign else str(uuid.uuid4())
    item = create_vehicle(client, home_a, odometer=100, service_due_odometer=200)
    body = service_body(
        item, performed_odometer=150, next_due_odometer=300, cost_amount="1000", account_id=account
    )
    expect_status(add_service(client, home_a, item, body), 422)
    assert current(client, home_a, item) == item
    assert history(client, home_a, item) == [] and finance(client, home_a) == []


def test_finance_amount_edit_is_reflected_and_deletion_stays_unavailable_on_replay(client, home_a):
    item = create_vehicle(client, home_a)
    body = service_body(item, cost_amount="1000")
    expect_status(add_service(client, home_a, item, body), 200)
    expense = finance(client, home_a)[0]
    expect_status(edit_expense(client, home_a, expense, amount="2000", note="اصلاح مبلغ"), 204)
    assert history(client, home_a, item)[0]["cost_amount"] == "2000.00"
    expect_status(client.delete(f"{API}/transactions/{expense['id']}", headers=home_a.h), 204)
    record = history(client, home_a, item)[0]
    assert record["cost_status"] == "unavailable"
    assert record["transaction_id"] is None and record["cost_amount"] is None
    replay = expect_status(add_service(client, home_a, item, body), 200).json()
    assert replay["replayed"] and replay["record"] == record
    assert finance(client, home_a) == [] and len(history(client, home_a, item)) == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"type": "income"},
        {"category": "food"},
        {"date": "2026-11-13"},
        {"repeat": "monthly", "repeat_end": "2027-01-01"},
        {"repeat_end": "2027-01-01"},
        {"source_kind": None},
        {"source_kind": "vehicle_service"},
    ],
)
def test_generated_expense_origin_cannot_be_changed_even_after_vehicle_deletion(
    client, home_a, fields
):
    item = create_vehicle(client, home_a)
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200
    ).json()
    expense = finance(client, home_a)[0]
    expect_status(remove(client, home_a, result["vehicle"]), 204)
    expect_status(edit_expense(client, home_a, expense, **fields), 422)
    assert finance(client, home_a) == [expense]


def test_generated_expense_member_and_transfer_destination_are_immutable(client, home_a):
    other = adult(client, home_a)
    account = make_account(client, home_a)
    item = create_vehicle(client, home_a)
    expect_status(add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200)
    expense = finance(client, home_a)[0]
    expect_status(edit_expense(client, home_a, expense, member_id=other.member_id), 422)
    expect_status(edit_expense(client, home_a, expense, to_account_id=account), 422)


def test_public_finance_creation_rejects_source_marker_and_leaves_existing_finance_unchanged(
    client, home_a
):
    manual_id = make_transaction(client, home_a)
    expense = finance(client, home_a)[0]
    assert expense["id"] == manual_id and expense["source_kind"] is None
    expect_status(
        client.post(
            f"{API}/transactions",
            headers=home_a.h,
            json={**{key: expense[key] for key in _TX_FIELDS}, "source_kind": "vehicle_service"},
        ),
        422,
    )
    expect_status(edit_expense(client, home_a, expense, category="transport"), 204)
    assert finance(client, home_a)[0]["category"] == "transport"


def test_child_cannot_read_or_mutate_tagged_expense_or_photos_even_after_vehicle_deletion(
    client, raw_sql, home_a
):
    child = add_active_member(client, home_a)
    expect_status(client.post(f"{AUTH}/members/{child.member_id}/promote", headers=home_a.h), 200)
    manual_id = make_transaction(client, home_a)
    item = create_vehicle(client, home_a)
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200
    ).json()
    expense = next(tx for tx in finance(client, home_a) if tx["id"] != manual_id)
    expect_status(
        client.post(
            f"{API}/transactions/{expense['id']}/photos",
            headers=home_a.h,
            json={"url": "https://example.invalid/service.jpg"},
        ),
        422,
    )
    photo = seed_source_photo(raw_sql, home_a, expense["id"])
    for before_delete in (True, False):
        if not before_delete:
            expect_status(remove(client, home_a, result["vehicle"]), 204)
        child_list = finance(client, child)
        assert [tx["id"] for tx in child_list] == [manual_id] and child_list[0]["photos"] == []
        expect_status(edit_expense(client, child, expense, amount="2000"), 404)
        expect_status(client.delete(f"{API}/transactions/{expense['id']}", headers=child.h), 404)
        expect_status(
            client.post(
                f"{API}/transactions/{expense['id']}/photos",
                headers=child.h,
                json={"url": "https://example.invalid/denied.jpg"},
            ),
            404,
        )
        expect_status(
            client.patch(
                f"{API}/photos/{photo['id']}", headers=child.h, json={"caption": "غیرمجاز"}
            ),
            404,
        )
        expect_status(client.delete(f"{API}/photos/{photo['id']}", headers=child.h), 404)
        expect_status(
            client.post(
                f"{API}/transactions/{expense['id']}/occurrences",
                headers=child.h,
                json={"due_date": "2026-11-15"},
            ),
            404,
        )
    assert len(finance(client, home_a)) == 2


def test_vehicle_service_attachment_is_rejected_without_persisting_and_other_finance_photos_work(
    client,
    raw_sql,
    home_a,
):
    item = create_vehicle(client, home_a)
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")),
        200,
    ).json()
    expense_id = result["record"]["transaction_id"]
    response = expect_status(
        client.post(
            f"{API}/transactions/{expense_id}/photos",
            headers=home_a.h,
            json={"url": "https://example.invalid/service-receipt.jpg"},
        ),
        422,
    )
    assert response.json() == {
        "error": "SOURCE_ATTACHMENT_UNAVAILABLE",
        "message": "رسید سرویس خودرو را از بخش اسناد خانه ثبت و به خودرو وصل کنید.",
    }
    assert finance(client, home_a)[0]["photos"] == []
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM transaction_photos")).scalar_one() == 0
    raw_sql.rollback()
    manual_id = make_transaction(client, home_a)
    expect_status(
        client.post(
            f"{API}/transactions/{manual_id}/photos",
            headers=home_a.h,
            json={"url": "https://example.invalid/manual-photo.jpg"},
        ),
        201,
    )
    manual = next(tx for tx in finance(client, home_a) if tx["id"] == manual_id)
    assert len(manual["photos"]) == 1


def test_concurrent_same_operation_creates_exactly_one_cost_and_record(client, home_a):
    item = create_vehicle(client, home_a, odometer=100)
    body = service_body(item, performed_odometer=200, cost_amount="1000")
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: add_service(client, home_a, item, body), range(2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert sorted(r.json()["replayed"] for r in responses) == [False, True]
    assert len(history(client, home_a, item)) == 1 and len(finance(client, home_a)) == 1
    assert current(client, home_a, item)["revision"] == 2


def test_cross_vehicle_concurrent_operation_collision_rolls_back_loser_cost_and_schedule(
    client, home_a
):
    items = [
        create_vehicle(client, home_a, title=title, odometer=100, service_due_odometer=150)
        for title in ("اول", "دوم")
    ]
    body = service_body(items[0], performed_odometer=200, next_due_odometer=500, cost_amount="1000")
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda item: add_service(client, home_a, item, body), items))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert len(finance(client, home_a)) == 1
    for item, response in zip(items, responses, strict=True):
        if response.status_code == 409:
            assert current(client, home_a, item) == item and history(client, home_a, item) == []
        else:
            assert current(client, home_a, item)["odometer"] == 200
            assert len(history(client, home_a, item)) == 1


def test_distinct_concurrent_services_from_same_revision_have_one_winner(client, home_a):
    item = create_vehicle(client, home_a)
    bodies = [service_body(item, cost_amount="1000"), service_body(item, cost_amount="2000")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: add_service(client, home_a, item, body), bodies))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert len(finance(client, home_a)) == 1 and len(history(client, home_a, item)) == 1


def test_replay_checks_request_actor_target_and_current_permission(client, raw_sql, home_a):
    creator = adult(client, home_a)
    item = create_vehicle(client, creator)
    body = service_body(item, cost_amount="1000")
    result = expect_status(add_service(client, creator, item, body), 200).json()
    expect_status(add_service(client, creator, item, {**body, "cost_amount": "2000"}), 409)
    expect_status(add_service(client, home_a, item, body), 409)
    second = create_vehicle(client, creator, title="دوم")
    expect_status(add_service(client, creator, second, body), 409)
    newer = expect_status(
        edit(client, creator, result["vehicle"], odometer=100, service_due_odometer=500), 200
    ).json()
    replay = expect_status(add_service(client, creator, item, body), 200).json()
    assert replay["vehicle"] == newer and replay["replayed"]
    scope(raw_sql, home_a, home_a.member_id)
    raw_sql.execute(
        text("UPDATE vehicles SET created_by=:mid WHERE id=:id"),
        {"mid": home_a.member_id, "id": item["id"]},
    )
    raw_sql.commit()
    expect_status(add_service(client, creator, item, body), 403)
    assert len(finance(client, home_a)) == 1


def test_vehicle_deletion_preserves_finance_document_and_task_but_removes_own_history(
    client, raw_sql, home_a
):
    doc = create_doc(client, home_a, visibility="shared")
    task = expect_status(
        client.post(f"{API}/tasks", headers=home_a.h, json={"title": "سرویس"}), 201
    ).json()
    item = create_vehicle(client, home_a, document_id=doc["id"], service_task_id=task["id"])
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200
    ).json()
    expect_status(remove(client, home_a, result["vehicle"]), 204)
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM maintenance_records")).scalar_one() == 0
    raw_sql.rollback()
    assert finance(client, home_a)[0]["source_kind"] == "vehicle_service"
    assert client.get(f"{API}/documents", headers=home_a.h).json()[0]["id"] == doc["id"]
    stored_task = client.get(f"{API}/tasks", headers=home_a.h).json()[0]
    assert stored_task["id"] == task["id"] and not stored_task["completed"]


def test_member_deletion_keeps_vehicle_history_and_existing_finance_member_cascade(
    client, raw_sql, home_a
):
    creator = adult(client, home_a)
    item = create_vehicle(client, creator)
    expect_status(add_service(client, creator, item, service_body(item, cost_amount="1000")), 200)
    scope(raw_sql, home_a, home_a.member_id)
    raw_sql.execute(text("DELETE FROM members WHERE id=:mid"), {"mid": creator.member_id})
    raw_sql.commit()
    assert current(client, home_a, item)["created_by"] is None
    record = history(client, home_a, item)[0]
    assert record["created_by"] is None and record["cost_status"] == "unavailable"
    assert finance(client, home_a) == []


def test_family_deletion_cascades_vehicles_history_and_cost(client, raw_sql, home_a):
    item = create_vehicle(client, home_a)
    expect_status(add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200)
    scope(raw_sql, home_a, home_a.member_id)
    raw_sql.execute(text("DELETE FROM families WHERE id=:fid"), {"fid": home_a.family_id})
    raw_sql.commit()
    scope(raw_sql, home_a, home_a.member_id)
    for table in ("vehicles", "maintenance_records", "transactions"):
        assert raw_sql.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0  # noqa: S608
    raw_sql.rollback()


def test_database_boundary_hides_sensitive_history_cost_and_photo_for_unset_or_child_context(
    client, raw_sql, home_a
):
    child = add_active_member(client, home_a)
    manual_id = make_transaction(client, home_a)
    item = create_vehicle(client, home_a)
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200
    ).json()
    expense_id = result["record"]["transaction_id"]
    expect_status(
        client.post(
            f"{API}/transactions/{expense_id}/photos",
            headers=home_a.h,
            json={"url": "https://example.invalid/receipt.jpg"},
        ),
        422,
    )
    seed_source_photo(raw_sql, home_a, expense_id)
    for member_id in (None, child.member_id, home_a.member_id):
        scope(raw_sql, home_a, member_id)
        assert raw_sql.execute(text("SELECT count(*) FROM vehicles")).scalar_one() == 1
        adult_context = member_id == home_a.member_id
        assert raw_sql.execute(
            text("SELECT count(*) FROM maintenance_records")
        ).scalar_one() == int(adult_context)
        assert raw_sql.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 1 + int(
            adult_context
        )
        assert raw_sql.execute(text("SELECT count(*) FROM transaction_photos")).scalar_one() == int(
            adult_context
        )
        assert raw_sql.execute(
            text("SELECT id FROM transactions WHERE id=:id"), {"id": manual_id}
        ).scalar_one()
        raw_sql.rollback()


@pytest.mark.parametrize(
    "assignment",
    [
        "source_kind=NULL",
        "type='income'",
        "category='food'",
        "date='2026-11-13'",
        "repeat='monthly',repeat_end='2027-01-01'",
    ],
)
def test_database_guard_keeps_service_expense_origin_after_vehicle_deletion(
    client, raw_sql, home_a, assignment
):
    item = create_vehicle(client, home_a)
    result = expect_status(
        add_service(client, home_a, item, service_body(item, cost_amount="1000")), 200
    ).json()
    expect_status(remove(client, home_a, result["vehicle"]), 204)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text(f"UPDATE transactions SET {assignment} WHERE id=:id"),  # noqa: S608
            {"id": result["record"]["transaction_id"]},
        )
    assert error.value.orig.sqlstate == "23514"
    raw_sql.rollback()


def test_database_prevents_odometer_decrease_and_cross_family_history_target(
    client, raw_sql, home_a, home_b
):
    item = create_vehicle(client, home_a, odometer=100)
    foreign = create_vehicle(client, home_b)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(IntegrityError):
        raw_sql.execute(text("UPDATE vehicles SET odometer=99 WHERE id=:id"), {"id": item["id"]})
    raw_sql.rollback()
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO maintenance_records "
                "(family_id,vehicle_id,performed_on,performed_odometer,description,"
                "operation_id,request_hash) "
                "VALUES (:fid,:vid,'2026-11-14',0,'test',:op,'hash')"
            ),
            {"fid": home_a.family_id, "vid": foreign["id"], "op": str(uuid.uuid4())},
        )
    assert error.value.orig.diag.constraint_name == "fk_maintenance_vehicle_family"
    raw_sql.rollback()


@pytest.mark.parametrize(
    "fields",
    [
        {"title": " "},
        {"brand": "a" * 81},
        {"model": "a" * 81},
        {"plate": "a" * 31},
        {"odometer": -1},
        {"odometer": 100000001},
        {"odometer": 1.5},
        {"odometer": True},
        {"service_due_odometer": "100"},
        {"purchase_date": "2026-02-30"},
        {"insurance_until": True},
        {"inspection_until": "2027-01-01T00:00:00Z"},
        {"family_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"service_reminder_enabled": 1},
    ],
)
def test_invalid_vehicle_inputs_do_not_insert(client, home_a, fields):
    expect_status(client.post(VEHICLES, headers=home_a.h, json={"title": "خودرو", **fields}), 422)
    assert listed(client, home_a)["vehicles"] == []


@pytest.mark.parametrize(
    "fields",
    [
        {"description": " "},
        {"performed_odometer": -1},
        {"performed_odometer": 1.5},
        {"performed_odometer": True},
        {"next_due_odometer": 0},
        {"next_due_odometer": 100000001},
        {"performed_on": "2026-02-30"},
        {"next_due_date": "2026-11-14"},
        {"cost_amount": "0"},
        {"cost_amount": "-1"},
        {"cost_amount": True},
        {"cost_amount": "1.001"},
        {"cost_amount": "1000000000000"},
        {"account_id": str(uuid.uuid4())},
        {"base_revision": True},
        {"source_kind": "vehicle_service"},
        {"member_id": str(uuid.uuid4())},
    ],
)
def test_invalid_service_input_leaves_all_domains_unchanged(client, home_a, fields):
    item = create_vehicle(client, home_a)
    expect_status(add_service(client, home_a, item, service_body(item, **fields)), 422)
    assert current(client, home_a, item) == item
    assert history(client, home_a, item) == [] and finance(client, home_a) == []


def test_tehran_today_dates_and_caps_are_enforced_without_partial_writes(
    client, home_a, monkeypatch
):
    from app.services import vehicles

    monkeypatch.setattr(vehicles, "today_tehran", lambda: date(2026, 11, 15))
    monkeypatch.setattr(vehicles, "_MAX_VEHICLES", 1)
    monkeypatch.setattr(vehicles, "_MAX_SERVICES", 1)
    expect_status(
        client.post(
            VEHICLES, headers=home_a.h, json={"title": "خودرو", "purchase_date": "2026-11-16"}
        ),
        422,
    )
    item = create_vehicle(client, home_a, purchase_date="2026-11-15")
    expect_status(client.post(VEHICLES, headers=home_a.h, json={"title": "دوم"}), 409)
    expect_status(
        add_service(client, home_a, item, service_body(item, performed_on="2026-11-16")), 422
    )
    result = expect_status(
        add_service(client, home_a, item, service_body(item, performed_on="2026-11-15")), 200
    ).json()
    expect_status(
        add_service(
            client, home_a, result["vehicle"], service_body(result["vehicle"], cost_amount="1000")
        ),
        409,
    )
    assert finance(client, home_a) == [] and len(history(client, home_a, item)) == 1


def test_no_store_auth_revocation_and_offline_exclusion(client, raw_sql, home_a):
    created_response = expect_status(
        client.post(VEHICLES, headers=home_a.h, json={"title": "خودرو"}), 201
    )
    item = created_response.json()
    for response in (
        created_response,
        client.get(VEHICLES, headers=home_a.h),
        client.get(f"{VEHICLES}/{item['id']}/services", headers=home_a.h),
        add_service(client, home_a, item),
        client.get(VEHICLES),
        client.post(VEHICLES, headers=home_a.h, json={"title": ""}),
        client.get(f"{VEHICLES}/{uuid.uuid4()}/services", headers=home_a.h),
    ):
        assert response.headers["Cache-Control"] == "no-store"
    snapshot = expect_status(client.get(f"{API}/shopping/offline", headers=home_a.h), 200).json()
    assert "vehicles" not in snapshot and "maintenance_records" not in snapshot
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:mid"),
        {"mid": home_a.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(VEHICLES, headers=home_a.h), 403)


def test_equipment_hash_and_replay_remain_compatible_with_pre_vehicle_records(
    client, raw_sql, home_a
):
    from app.schemas.equipment import MaintenanceWrite
    from tests.test_equipment import add_service as equipment_service
    from tests.test_equipment import create_equipment
    from tests.test_equipment import service_body as equipment_body

    equipment = create_equipment(client, home_a)
    body = equipment_body(equipment, description="  تعویض فیلتر  ")
    result = expect_status(equipment_service(client, home_a, equipment, body), 200).json()
    old_values = MaintenanceWrite.model_validate(body).model_dump(
        mode="json", exclude={"operation_id"}
    )
    old_values.update(equipment_id=equipment["id"], description="تعویض فیلتر")
    expected_hash = hashlib.sha256(
        json.dumps(old_values, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    scope(raw_sql, home_a, home_a.member_id)
    stored_hash = raw_sql.execute(
        text("SELECT request_hash FROM maintenance_records WHERE id=:id"),
        {"id": result["record"]["id"]},
    ).scalar_one()
    assert stored_hash == expected_hash
    raw_sql.rollback()
    replay = expect_status(equipment_service(client, home_a, equipment, body), 200).json()
    assert replay["replayed"] and replay["record"] == result["record"]
    vehicle = create_vehicle(client, home_a)
    expect_status(
        add_service(
            client,
            home_a,
            vehicle,
            service_body(vehicle, operation_id=body["operation_id"], cost_amount="1000"),
        ),
        409,
    )
    assert history(client, home_a, vehicle) == [] and finance(client, home_a) == []
