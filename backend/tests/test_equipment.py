"""Real PostgreSQL/HTTP boundaries, links and atomic service completion."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import API, AUTH, add_active_member, expect_status
from tests.test_documents import create_doc
from tests.test_documents import update as update_doc

EQUIPMENT = f"{API}/equipment"
_INPUT_FIELDS = (
    "title",
    "brand",
    "model",
    "purchase_date",
    "warranty_until",
    "warranty_document_id",
    "service_task_id",
    "service_due_date",
    "service_reminder_enabled",
)


def create_equipment(client, actor, **fields):
    return expect_status(
        client.post(EQUIPMENT, headers=actor.h, json={"title": "یخچال", **fields}), 201
    ).json()


def listed(client, actor):
    return expect_status(client.get(EQUIPMENT, headers=actor.h), 200).json()


def edit(client, actor, item, **fields):
    return client.patch(
        f"{EQUIPMENT}/{item['id']}",
        headers=actor.h,
        json={
            **{key: item[key] for key in _INPUT_FIELDS},
            "base_revision": item["revision"],
            **fields,
        },
    )


def remove(client, actor, item):
    return client.delete(
        f"{EQUIPMENT}/{item['id']}", headers=actor.h, params={"base_revision": item["revision"]}
    )


def service_body(item, **fields):
    return {
        "operation_id": str(uuid.uuid4()),
        "base_revision": item["revision"],
        "performed_on": "2026-11-14",
        "description": "تعویض فیلتر",
        "next_due_date": None,
        **fields,
    }


def add_service(client, actor, item, body=None):
    return client.post(
        f"{EQUIPMENT}/{item['id']}/services", headers=actor.h, json=body or service_body(item)
    )


def history(client, actor, item):
    return expect_status(
        client.get(f"{EQUIPMENT}/{item['id']}/services", headers=actor.h), 200
    ).json()


def make_task(client, actor):
    return expect_status(
        client.post(f"{API}/tasks", headers=actor.h, json={"title": "سرویس یخچال"}), 201
    ).json()


def adult(client, owner, name="عضو بزرگسال"):
    actor = add_active_member(client, owner, name)
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=owner.h, json={"relation": "سایر"}
        ),
        200,
    )
    return actor


def set_family(raw_sql, actor):
    raw_sql.execute(
        text("SELECT set_config('app.family_id', :fid, true)"), {"fid": actor.family_id}
    )


def test_equipment_crud_normalizes_text_and_advances_noop_revision(client, home_a):
    item = create_equipment(
        client,
        home_a,
        title="  کولر   آبی ",
        brand=" برند ",
        model=" ",
        purchase_date="2026-01-01",
        warranty_until="2027-01-01",
    )
    assert item["title"] == "کولر آبی" and item["brand"] == "برند" and item["model"] is None
    assert item["created_by"] == home_a.member_id and item["revision"] == 1
    assert item["can_edit"] and item["can_delete"] and item["service_reminder_enabled"]
    assert "family_id" not in item
    assert listed(client, home_a) == [item]
    updated = expect_status(edit(client, home_a, item, title="کولر"), 200).json()
    assert updated["revision"] == 2
    noop = expect_status(edit(client, home_a, updated), 200).json()
    assert noop["revision"] == 3
    expect_status(remove(client, home_a, noop), 204)
    assert listed(client, home_a) == []


def test_creator_and_both_admins_can_modify_and_log_ordinary_member_cannot(client, home_a):
    creator = add_active_member(client, home_a, "سازنده")
    other = add_active_member(client, home_a, "عضو دیگر")
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    item = create_equipment(client, creator)
    assert not listed(client, other)[0]["can_edit"]
    expect_status(edit(client, other, item), 403)
    expect_status(remove(client, other, item), 403)
    expect_status(add_service(client, other, item), 403)
    assert history(client, other, item) == []
    item = expect_status(edit(client, creator, item), 200).json()
    item = expect_status(add_service(client, admin, item), 200).json()["equipment"]
    item = expect_status(edit(client, home_a, item), 200).json()
    assert len(history(client, other, item)) == 1
    expect_status(remove(client, admin, item), 204)


def test_cross_family_items_and_history_are_inaccessible(client, home_a, home_b):
    item = create_equipment(client, home_a)
    expect_status(add_service(client, home_a, item), 200)
    assert listed(client, home_b) == []
    expect_status(edit(client, home_b, item), 404)
    expect_status(remove(client, home_b, item), 404)
    expect_status(add_service(client, home_b, item), 404)
    expect_status(client.get(f"{EQUIPMENT}/{item['id']}/services", headers=home_b.h), 404)


def test_stale_equipment_changes_and_services_leave_schedule_and_history_intact(client, home_a):
    item = create_equipment(client, home_a, service_due_date="2026-11-15")
    current = expect_status(edit(client, home_a, item, service_due_date="2026-12-01"), 200).json()
    expect_status(edit(client, home_a, item), 409)
    expect_status(remove(client, home_a, item), 409)
    expect_status(add_service(client, home_a, item), 409)
    assert listed(client, home_a) == [current] and history(client, home_a, item) == []


def test_service_atomically_advances_schedule_and_same_operation_replays_without_writing(
    client, home_a
):
    item = create_equipment(client, home_a, service_due_date="2026-11-15")
    body = service_body(item, description="  تعویض فیلتر  ", next_due_date="2027-01-15")
    first = expect_status(add_service(client, home_a, item, body), 200).json()
    assert first["replayed"] is False
    assert first["equipment"]["service_due_date"] == "2027-01-15"
    assert first["equipment"]["revision"] == item["revision"] + 1
    assert first["record"]["description"] == "تعویض فیلتر"
    assert first["record"]["next_due_date"] == "2027-01-15"
    assert "operation_id" not in first["record"] and "request_hash" not in first["record"]
    replay = expect_status(add_service(client, home_a, item, body), 200).json()
    assert replay["replayed"] and replay["record"] == first["record"]
    assert replay["equipment"] == first["equipment"]
    assert history(client, home_a, item) == [first["record"]]
    clear = expect_status(add_service(client, home_a, first["equipment"]), 200).json()
    assert clear["equipment"]["service_due_date"] is None


def test_operation_cannot_be_reused_with_changed_body_or_by_another_admin(client, home_a):
    admin = add_active_member(client, home_a)
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    item = create_equipment(client, home_a)
    body = service_body(item)
    first = expect_status(add_service(client, home_a, item, body), 200).json()
    expect_status(add_service(client, home_a, item, {**body, "description": "تغییر شرح"}), 409)
    expect_status(add_service(client, admin, item, body), 409)
    another = create_equipment(client, home_a, title="کولر")
    expect_status(add_service(client, home_a, another, body), 409)
    assert (
        next(row for row in listed(client, home_a) if row["id"] == item["id"]) == first["equipment"]
    )
    assert history(client, home_a, item) == [first["record"]]
    assert history(client, home_a, another) == []


def test_replay_requires_current_permission_and_does_not_replace_later_schedule(
    client, raw_sql, home_a
):
    creator = add_active_member(client, home_a)
    item = create_equipment(client, creator)
    body = service_body(item)
    completed = expect_status(add_service(client, creator, item, body), 200).json()
    newer = expect_status(
        edit(client, home_a, completed["equipment"], service_due_date="2027-02-01"), 200
    ).json()
    replayed = expect_status(add_service(client, creator, item, body), 200).json()
    assert replayed["equipment"]["service_due_date"] == newer["service_due_date"]
    set_family(raw_sql, home_a)
    raw_sql.execute(
        text("UPDATE home_equipment SET created_by=:mid WHERE id=:id"),
        {"mid": home_a.member_id, "id": item["id"]},
    )
    raw_sql.commit()
    expect_status(add_service(client, creator, item, body), 403)


def test_concurrent_unchanged_service_operation_creates_one_history_and_one_revision(
    client, home_a
):
    item = create_equipment(client, home_a, service_due_date="2026-11-15")
    body = service_body(item, next_due_date="2027-01-01")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: add_service(client, home_a, item, body), range(2)))
    assert [response.status_code for response in results] == [200, 200]
    assert sorted(response.json()["replayed"] for response in results) == [False, True]
    assert len(history(client, home_a, item)) == 1
    assert listed(client, home_a)[0]["revision"] == 2


def test_concurrent_distinct_services_from_same_revision_have_one_winner(client, home_a):
    item = create_equipment(client, home_a)
    bodies = [service_body(item, description="فیلتر"), service_body(item, description="نظافت")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda body: add_service(client, home_a, item, body), bodies))
    assert sorted(response.status_code for response in results) == [200, 409]
    assert len(history(client, home_a, item)) == 1
    assert listed(client, home_a)[0]["revision"] == 2


def test_concurrent_operation_collision_does_not_change_the_other_equipment(client, home_a):
    first = create_equipment(client, home_a, service_due_date="2026-11-15")
    second = create_equipment(client, home_a, title="کولر", service_due_date="2026-11-15")
    body = service_body(first, next_due_date="2027-01-01")
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda item: add_service(client, home_a, item, body), [first, second])
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    for item, response in zip([first, second], responses, strict=True):
        stored = next(row for row in listed(client, home_a) if row["id"] == item["id"])
        if response.status_code == 200:
            assert stored["revision"] == 2 and stored["service_due_date"] == "2027-01-01"
            assert len(history(client, home_a, item)) == 1
        else:
            assert stored == item and history(client, home_a, item) == []


def test_shared_links_respect_document_privacy_and_child_eligibility(client, home_a, home_b):
    creator = adult(client, home_a)
    doc = create_doc(client, creator, visibility="shared")
    private = create_doc(client, creator)
    other_doc = create_doc(client, home_b, visibility="shared")
    other_task = make_task(client, home_b)
    task = make_task(client, home_a)
    item = create_equipment(
        client, creator, warranty_document_id=doc["id"], service_task_id=task["id"]
    )
    assert item["warranty_document_id"] == doc["id"] and item["service_task_id"] == task["id"]
    # Another adult may link a shared document owned by someone else.
    other_adult = adult(client, home_a, "عضو دوم")
    shared = create_equipment(client, other_adult, warranty_document_id=doc["id"])
    assert shared["warranty_document_id"] == doc["id"]
    for link in (private, other_doc):
        expect_status(edit(client, creator, item, warranty_document_id=link["id"]), 404)
    expect_status(edit(client, creator, item, service_task_id=other_task["id"]), 404)
    child = add_active_member(client, home_a)
    assert all(row["warranty_document_id"] is None for row in listed(client, child))
    child_item = create_equipment(client, child)
    expect_status(edit(client, child, child_item, warranty_document_id=doc["id"]), 403)
    expect_status(update_doc(client, creator, doc, visibility="private"), 200)
    assert all(row["warranty_document_id"] is None for row in listed(client, creator))
    assert all(row["warranty_document_id"] is None for row in listed(client, home_a))


def test_deleting_linked_document_and_task_clears_references_and_keeps_family_and_service(
    client, home_a
):
    doc = create_doc(client, home_a, visibility="shared")
    task = make_task(client, home_a)
    item = create_equipment(
        client, home_a, warranty_document_id=doc["id"], service_task_id=task["id"]
    )
    completed = expect_status(add_service(client, home_a, item), 200).json()
    expect_status(
        client.delete(
            f"{API}/documents/{doc['id']}",
            headers=home_a.h,
            params={"base_revision": doc["revision"]},
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
    stored = listed(client, home_a)[0]
    assert stored["warranty_document_id"] is None and stored["service_task_id"] is None
    assert stored["revision"] > completed["equipment"]["revision"]
    assert history(client, home_a, item) == [completed["record"]]


@pytest.mark.parametrize("target", ["document", "task", "equipment"])
def test_database_composite_fks_reject_cross_family_links(client, raw_sql, home_a, home_b, target):
    if target == "equipment":
        foreign = create_equipment(client, home_b)
        statement = (
            "INSERT INTO maintenance_records (family_id,equipment_id,performed_on,description,"
            "operation_id,request_hash) VALUES (:fid,:linked,'2026-11-14','test',:op,'hash')"
        )
        constraint = "fk_maintenance_equipment_family"
    else:
        foreign = (
            create_doc(client, home_b, visibility="shared")
            if target == "document"
            else make_task(client, home_b)
        )
        statement = {
            "document": "INSERT INTO home_equipment (family_id,title,warranty_document_id) "
            "VALUES (:fid,'test',:linked)",
            "task": "INSERT INTO home_equipment (family_id,title,service_task_id) "
            "VALUES (:fid,'test',:linked)",
        }[target]
        constraint = f"fk_equipment_{target}_family"
    set_family(raw_sql, home_a)
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text(statement),
            {"fid": home_a.family_id, "linked": foreign["id"], "op": str(uuid.uuid4())},
        )
    assert error.value.orig.diag.constraint_name == constraint
    raw_sql.rollback()


def test_equipment_deletion_cascades_history_without_deleting_or_completing_links(
    client, raw_sql, home_a
):
    doc = create_doc(client, home_a, visibility="shared")
    task = make_task(client, home_a)
    item = create_equipment(
        client, home_a, warranty_document_id=doc["id"], service_task_id=task["id"]
    )
    current = expect_status(add_service(client, home_a, item), 200).json()["equipment"]
    expect_status(remove(client, home_a, current), 204)
    set_family(raw_sql, home_a)
    assert raw_sql.execute(text("SELECT count(*) FROM maintenance_records")).scalar_one() == 0
    raw_sql.rollback()
    assert (
        expect_status(client.get(f"{API}/documents", headers=home_a.h), 200).json()[0]["id"]
        == doc["id"]
    )
    task_list = expect_status(client.get(f"{API}/tasks", headers=home_a.h), 200).json()
    assert task_list[0]["id"] == task["id"] and task_list[0]["completed"] is False


def test_creator_deletion_preserves_equipment_and_history_for_admin(client, raw_sql, home_a):
    creator = add_active_member(client, home_a)
    item = create_equipment(client, creator)
    body = service_body(item)
    expect_status(add_service(client, creator, item, body), 200)
    set_family(raw_sql, home_a)
    raw_sql.execute(text("DELETE FROM members WHERE id=:mid"), {"mid": creator.member_id})
    raw_sql.commit()
    stored = listed(client, home_a)[0]
    assert stored["created_by"] is None and stored["can_edit"]
    assert history(client, home_a, item)[0]["created_by"] is None
    expect_status(add_service(client, home_a, item, body), 409)


def test_family_deletion_cascades_equipment_history_and_references(client, raw_sql, home_a):
    doc = create_doc(client, home_a, visibility="shared")
    task = make_task(client, home_a)
    item = create_equipment(
        client, home_a, warranty_document_id=doc["id"], service_task_id=task["id"]
    )
    expect_status(add_service(client, home_a, item), 200)
    set_family(raw_sql, home_a)
    raw_sql.execute(text("DELETE FROM families WHERE id=:fid"), {"fid": home_a.family_id})
    raw_sql.commit()
    set_family(raw_sql, home_a)
    assert raw_sql.execute(text("SELECT count(*) FROM home_equipment")).scalar_one() == 0
    assert raw_sql.execute(text("SELECT count(*) FROM maintenance_records")).scalar_one() == 0
    raw_sql.rollback()


@pytest.mark.parametrize(
    "extra",
    [
        {"title": " "},
        {"brand": "a" * 81},
        {"model": "a" * 81},
        {"purchase_date": "2026-02-30"},
        {"service_due_date": True},
        {"warranty_until": "2026-11-15T00:00:00Z"},
        {"purchase_date": "2026-11-15", "warranty_until": "2026-11-14"},
        {"family_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"price": 1000},
        {"service_reminder_enabled": 1},
    ],
)
def test_invalid_equipment_inputs_are_rejected_without_inserting(client, home_a, extra):
    expect_status(client.post(EQUIPMENT, headers=home_a.h, json={"title": "وسیله", **extra}), 422)
    assert listed(client, home_a) == []


@pytest.mark.parametrize(
    "extra",
    [
        {"description": " "},
        {"description": "a" * 1001},
        {"performed_on": "2026-02-30"},
        {"performed_on": "2026-11-15T00:00:00Z"},
        {"performed_on": None},
        {"next_due_date": "2026-11-14"},
        {"base_revision": True},
        {"operation_id": "bad"},
        {"cost": 1000},
        {"created_by": str(uuid.uuid4())},
    ],
)
def test_invalid_services_leave_no_history_or_schedule_change(client, home_a, extra):
    item = create_equipment(client, home_a, service_due_date="2026-11-15")
    expect_status(add_service(client, home_a, item, service_body(item, **extra)), 422)
    assert listed(client, home_a) == [item] and history(client, home_a, item) == []


def test_future_service_date_is_rejected_using_tehran_today(client, home_a, monkeypatch):
    from app.services import equipment

    monkeypatch.setattr(equipment, "today_tehran", lambda: date(2026, 11, 15))
    item = create_equipment(client, home_a)
    expect_status(
        add_service(client, home_a, item, service_body(item, performed_on="2026-11-16")), 422
    )
    today = expect_status(
        add_service(client, home_a, item, service_body(item, performed_on="2026-11-15")), 200
    ).json()
    assert today["record"]["performed_on"] == "2026-11-15"


def test_caps_and_missing_or_inactive_auth_cannot_partially_write(
    client, raw_sql, home_a, monkeypatch
):
    from app.services import equipment

    monkeypatch.setattr(equipment, "_MAX_EQUIPMENT", 1)
    monkeypatch.setattr(equipment, "_MAX_SERVICES", 1)
    item = create_equipment(client, home_a, service_due_date="2026-11-15")
    expect_status(client.post(EQUIPMENT, headers=home_a.h, json={"title": "دوم"}), 409)
    completed = expect_status(add_service(client, home_a, item), 200).json()
    current = completed["equipment"]
    expect_status(
        add_service(client, home_a, current, service_body(current, next_due_date="2027-01-01")), 409
    )
    assert listed(client, home_a) == [current] and len(history(client, home_a, item)) == 1
    expect_status(client.get(EQUIPMENT), 401)
    expect_status(client.get(f"{EQUIPMENT}/{item['id']}/services"), 401)
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:mid"),
        {"mid": home_a.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(EQUIPMENT, headers=home_a.h), 403)
    expect_status(add_service(client, home_a, current), 403)


def test_new_domain_notification_preferences_persist_independently(client, home_a):
    prefs = f"{API}/notifications/prefs"
    expect_status(
        client.patch(
            prefs,
            headers=home_a.h,
            json={"domains": {"equipment": False}, "lead_days": {"equipment": 7}},
        ),
        200,
    )
    state = expect_status(client.get(prefs, headers=home_a.h), 200).json()
    assert state["domains"]["equipment"] is False and state["lead_days"]["equipment"] == 7


def test_equipment_and_history_responses_are_no_store_and_excluded_from_offline(client, home_a):
    response = expect_status(client.post(EQUIPMENT, headers=home_a.h, json={"title": "وسیله"}), 201)
    assert response.headers["Cache-Control"] == "no-store"
    item = response.json()
    service = expect_status(add_service(client, home_a, item), 200)
    assert service.headers["Cache-Control"] == "no-store"
    assert client.get(EQUIPMENT, headers=home_a.h).headers["Cache-Control"] == "no-store"
    assert (
        client.get(f"{EQUIPMENT}/{item['id']}/services", headers=home_a.h).headers["Cache-Control"]
        == "no-store"
    )
    for response in (
        client.get(EQUIPMENT),
        client.post(EQUIPMENT, headers=home_a.h, json={"title": "", "price": 10}),
        client.get(f"{EQUIPMENT}/{uuid.uuid4()}/services", headers=home_a.h),
    ):
        assert response.status_code in {401, 404, 422}
        assert response.headers["Cache-Control"] == "no-store"
    snapshot = expect_status(client.get(f"{API}/shopping/offline", headers=home_a.h), 200).json()
    assert (
        "equipment" not in snapshot
        and "home_equipment" not in snapshot
        and "maintenance_records" not in snapshot
    )
    assert expect_status(client.get(f"{API}/transactions", headers=home_a.h), 200).json() == []
    assert expect_status(client.get(f"{API}/inventory", headers=home_a.h), 200).json() == []
