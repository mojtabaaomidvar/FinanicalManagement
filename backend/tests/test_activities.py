"""Shared activities retain one calendar event with guarded participants and revisions."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.conftest import API, AUTH, add_active_member, expect_status, next_phone

ACTIVITIES = f"{API}/activities"
_INPUT_FIELDS = (
    "title",
    "note",
    "date",
    "location",
    "status",
    "participant_ids",
    "reminder_enabled",
)


def create_activity(client, actor, **fields):
    return expect_status(
        client.post(
            ACTIVITIES, headers=actor.h, json={"title": "پیک‌نیک", "date": "2026-11-15", **fields}
        ),
        201,
    ).json()


def listed(client, actor):
    return expect_status(client.get(ACTIVITIES, headers=actor.h), 200).json()


def get_activity(client, actor, item):
    return client.get(f"{ACTIVITIES}/{item['id']}", headers=actor.h)


def edit(client, actor, item, **fields):
    return client.patch(
        f"{ACTIVITIES}/{item['id']}",
        headers=actor.h,
        json={
            **{key: item[key] for key in _INPUT_FIELDS},
            "base_revision": item["revision"],
            **fields,
        },
    )


def remove(client, actor, item):
    return client.delete(
        f"{ACTIVITIES}/{item['id']}", headers=actor.h, params={"base_revision": item["revision"]}
    )


def events(client, actor):
    return expect_status(client.get(f"{API}/events", headers=actor.h), 200).json()


def legacy_event(client, actor, **fields):
    return expect_status(
        client.post(
            f"{API}/events",
            headers=actor.h,
            json={"title": "مناسبت", "date": "2026-11-15", **fields},
        ),
        201,
    ).json()


def scope(conn, actor, member_id=None):
    conn.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": actor.family_id, "mid": member_id or ""},
    )


def introduced(client, actor):
    return expect_status(
        client.post(
            f"{AUTH}/members",
            headers=actor.h,
            json={"name": "کودک معرفی‌شده", "phone": next_phone(), "relation": "فرزند"},
        ),
        200,
    ).json()


def test_activity_crud_defaults_and_calendar_share_one_id_and_date(client, raw_sql, home_a):
    item = create_activity(
        client,
        home_a,
        title="  برنامهٔ   خانواده ",
        note=" خط اول\nخط دوم ",
        location="  پارک   محله ",
    )
    assert item["title"] == "برنامهٔ خانواده" and item["note"] == "خط اول\nخط دوم"
    assert item["location"] == "پارک محله" and item["status"] == "planned"
    assert item["reminder_enabled"] and item["revision"] == 1 and item["participant_ids"] == []
    assert item["created_by"] == home_a.member_id and item["can_edit"] and item["can_delete"]
    assert "family_id" not in item and "kind" not in item
    assert listed(client, home_a) == {"activities": [item], "can_create": True}
    assert expect_status(get_activity(client, home_a, item), 200).json() == item
    calendar = events(client, home_a)
    assert len(calendar) == 1 and calendar[0]["id"] == item["id"]
    assert calendar[0]["date"] == item["date"] and calendar[0]["kind"] == "activity"
    assert calendar[0]["activity_status"] == "planned" and calendar[0]["revision"] == 1
    item = expect_status(edit(client, home_a, item, status="done", date="2026-10-01"), 200).json()
    assert events(client, home_a)[0]["activity_status"] == "done"
    assert events(client, home_a)[0]["date"] == "2026-10-01" and item["revision"] == 2
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM family_events")).scalar_one() == 1
    raw_sql.rollback()
    expect_status(remove(client, home_a, item), 204)
    assert listed(client, home_a)["activities"] == [] and events(client, home_a) == []


def test_cancelled_activity_can_be_replanned_and_noop_advances_revision(client, home_a):
    item = create_activity(client, home_a, status="cancelled", reminder_enabled=False)
    item = expect_status(
        edit(client, home_a, item, status="planned", reminder_enabled=True), 200
    ).json()
    assert item["status"] == "planned" and item["reminder_enabled"]
    noop = expect_status(edit(client, home_a, item), 200).json()
    assert noop["revision"] == item["revision"] + 1


def test_creator_admin_child_and_participant_permissions_are_independent(client, home_a):
    creator = add_active_member(client, home_a, "سازنده")
    participant = add_active_member(client, home_a, "شرکت‌کننده")
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    item = create_activity(client, creator, participant_ids=[participant.member_id])
    assert listed(client, creator)["can_create"]
    view = expect_status(get_activity(client, participant, item), 200).json()
    assert not view["can_edit"] and not view["can_delete"]
    expect_status(edit(client, participant, item), 403)
    expect_status(remove(client, participant, item), 403)
    item = expect_status(edit(client, creator, item, title="اصلاح سازنده"), 200).json()
    item = expect_status(edit(client, admin, item, title="اصلاح مدیر"), 200).json()
    item = expect_status(edit(client, home_a, item, title="اصلاح مدیر خانواده"), 200).json()
    expect_status(remove(client, creator, item), 204)


def test_cross_family_activity_ids_and_participants_are_rejected(client, home_a, home_b):
    item = create_activity(client, home_a)
    assert listed(client, home_b)["activities"] == []
    expect_status(get_activity(client, home_b, item), 404)
    expect_status(edit(client, home_b, item), 404)
    expect_status(remove(client, home_b, item), 404)
    expect_status(
        client.post(
            ACTIVITIES,
            headers=home_a.h,
            json={"title": "برنامه", "date": "2026-11-15", "participant_ids": [home_b.member_id]},
        ),
        422,
    )
    expect_status(edit(client, home_a, item, participant_ids=[home_b.member_id]), 422)
    assert expect_status(get_activity(client, home_a, item), 200).json() == item


def test_introduced_pending_status_member_is_selectable_but_suspended_member_is_not(
    client, raw_sql, home_a
):
    child = introduced(client, home_a)
    assert child["status"] == "pending" and child["membership_state"] == "active"
    item = create_activity(client, home_a, participant_ids=[child["id"], home_a.member_id])
    assert item["participant_ids"] == sorted([child["id"], home_a.member_id])
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:id"), {"id": child["id"]}
    )
    raw_sql.commit()
    current = expect_status(get_activity(client, home_a, item), 200).json()
    assert current["participant_ids"] == [home_a.member_id]
    expect_status(edit(client, home_a, current, participant_ids=[child["id"]]), 422)
    current = expect_status(edit(client, home_a, current, participant_ids=[]), 200).json()
    assert current["participant_ids"] == []
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM activity_participants")).scalar_one() == 0
    raw_sql.rollback()


def test_member_selection_is_replaced_atomically_and_invalid_selection_does_not_modify_program(
    client, home_a
):
    first = add_active_member(client, home_a, "اول")
    second = add_active_member(client, home_a, "دوم")
    item = create_activity(client, home_a, participant_ids=[first.member_id])
    updated = expect_status(
        edit(client, home_a, item, participant_ids=[second.member_id], status="done"), 200
    ).json()
    assert updated["participant_ids"] == [second.member_id]
    assert updated["status"] == "done" and updated["revision"] == item["revision"] + 1
    calendar = next(row for row in events(client, home_a) if row["id"] == item["id"])
    assert calendar["activity_status"] == "done" and calendar["revision"] == updated["revision"]
    expect_status(
        edit(client, home_a, updated, title="نام اشتباه", participant_ids=[str(uuid.uuid4())]), 422
    )
    assert expect_status(get_activity(client, home_a, item), 200).json() == updated


def test_stale_revision_and_concurrent_edits_have_one_winner(client, home_a):
    item = create_activity(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda title: edit(client, home_a, item, title=title), ["اول", "دوم"])
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    expect_status(remove(client, home_a, item), 409)
    assert expect_status(get_activity(client, home_a, item), 200).json() == winner


def test_family_activity_cap_is_serialized_and_legacy_events_do_not_count(
    client, home_a, monkeypatch
):
    from app.services import activities

    monkeypatch.setattr(activities, "_MAX_ACTIVITIES", 1)
    legacy_event(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda title: client.post(
                    ACTIVITIES, headers=home_a.h, json={"title": title, "date": "2026-11-15"}
                ),
                ["اول", "دوم"],
            )
        )
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(listed(client, home_a)["activities"]) == 1 and len(events(client, home_a)) == 2


@pytest.mark.parametrize(
    "fields",
    [
        {"title": " "},
        {"title": None},
        {"title": "x" * 121},
        {"note": "x" * 2001},
        {"location": "x" * 181},
        {"date": None},
        {"date": True},
        {"date": "2026-02-30"},
        {"date": "2026-11-15T00:00:00Z"},
        {"status": "active"},
        {"status": None},
        {"reminder_enabled": "true"},
        {"reminder_enabled": 1},
        {"participant_ids": None},
        {"participant_ids": ["not-a-uuid"]},
        {"participant_ids": [str(uuid.uuid4()) for _ in range(51)]},
        {"kind": "activity"},
        {"created_by": str(uuid.uuid4())},
        {"member_id": str(uuid.uuid4())},
        {"family_id": str(uuid.uuid4())},
        {"cost_amount": "1000"},
        {"time": "12:00"},
        {"repeat": "weekly"},
        {"document_id": str(uuid.uuid4())},
    ],
)
def test_invalid_or_out_of_scope_creation_inputs_do_not_persist(client, home_a, fields):
    expect_status(
        client.post(
            ACTIVITIES, headers=home_a.h, json={"title": "برنامه", "date": "2026-11-15", **fields}
        ),
        422,
    )
    assert listed(client, home_a)["activities"] == [] and events(client, home_a) == []


def test_duplicate_participant_ids_and_invalid_revisions_are_rejected(client, home_a):
    item = create_activity(client, home_a)
    for fields in (
        {"participant_ids": [home_a.member_id, home_a.member_id]},
        {"base_revision": True},
        {"base_revision": "1"},
        {"base_revision": 0},
        {"base_revision": 1.5},
    ):
        expect_status(edit(client, home_a, item, **fields), 422)
    assert expect_status(get_activity(client, home_a, item), 200).json() == item


def test_text_limits_and_past_dates_are_supported(client, home_a):
    item = create_activity(
        client, home_a, title="x" * 120, note="x" * 2000, location="x" * 180, date="2020-01-01"
    )
    assert len(item["title"]) == 120 and len(item["note"]) == 2000 and len(item["location"]) == 180


def test_legacy_events_keep_neutral_fields_duplicate_rule_and_normal_deletion(client, home_a):
    activity = create_activity(client, home_a, title="هم‌نام")
    event = legacy_event(client, home_a, title="هم‌نام")
    assert event["id"] != activity["id"] and event["kind"] == "event"
    assert event["activity_status"] is None and event["reminder_enabled"] and event["revision"] == 1
    expect_status(
        client.post(
            f"{API}/events", headers=home_a.h, json={"title": "هم‌نام", "date": "2026-11-15"}
        ),
        409,
    )
    expect_status(client.delete(f"{API}/events/{event['id']}", headers=home_a.h), 204)
    assert [row["id"] for row in events(client, home_a)] == [activity["id"]]


def test_legacy_event_delete_cannot_bypass_activity_revision(client, home_a):
    item = create_activity(client, home_a)
    response = expect_status(client.delete(f"{API}/events/{item['id']}", headers=home_a.h), 409)
    assert response.json()["error"] == "ACTIVITY_ROUTE_REQUIRED"
    assert expect_status(get_activity(client, home_a, item), 200).json() == item
    legacy = legacy_event(client, home_a)
    expect_status(client.get(f"{ACTIVITIES}/{legacy['id']}", headers=home_a.h), 404)
    expect_status(
        client.delete(
            f"{ACTIVITIES}/{legacy['id']}", headers=home_a.h, params={"base_revision": 1}
        ),
        404,
    )


def test_birthday_sync_preserves_activity_with_birthday_title_and_creates_legacy_event(
    client, raw_sql, home_a
):
    child = add_active_member(client, home_a, "آراد")
    raw_sql.execute(
        text("UPDATE members SET birth_date='2010-11-15' WHERE id=:id"), {"id": child.member_id}
    )
    raw_sql.commit()
    item = create_activity(client, home_a, title="تولد آراد", participant_ids=[child.member_id])
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    assert expect_status(get_activity(client, home_a, item), 200).json() == item
    calendar = events(client, home_a)
    matching = [row for row in calendar if row["for_member_id"] == child.member_id]
    assert len(matching) == 1 and matching[0]["kind"] == "event" and matching[0]["id"] != item["id"]
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    assert (
        len([row for row in events(client, home_a) if row["for_member_id"] == child.member_id]) == 1
    )


def test_database_read_context_and_creator_admin_writes_are_enforced(client, raw_sql, home_a):
    creator = add_active_member(client, home_a, "سازنده")
    other = add_active_member(client, home_a, "دیگر")
    legacy_event(client, home_a)
    item = create_activity(client, creator, participant_ids=[other.member_id])
    for member_id, count in (
        (None, 1),
        (creator.member_id, 2),
        (other.member_id, 2),
        (home_a.member_id, 2),
    ):
        scope(raw_sql, home_a, member_id)
        assert raw_sql.execute(text("SELECT count(*) FROM family_events")).scalar_one() == count
        assert raw_sql.execute(
            text("SELECT count(*) FROM activity_participants")
        ).scalar_one() == int(member_id is not None)
        raw_sql.rollback()
    scope(raw_sql, home_a, other.member_id)
    assert (
        raw_sql.execute(
            text("UPDATE family_events SET title='denied' WHERE id=:id"), {"id": item["id"]}
        ).rowcount
        == 0
    )
    assert (
        raw_sql.execute(
            text("DELETE FROM activity_participants WHERE activity_id=:id"), {"id": item["id"]}
        ).rowcount
        == 0
    )
    raw_sql.rollback()
    assert expect_status(get_activity(client, home_a, item), 200).json()["title"] == item["title"]


@pytest.mark.parametrize("forgery", ["unset", "creator"])
def test_database_rejects_insert_without_member_or_with_forged_creator(
    client, raw_sql, home_a, forgery
):
    child = add_active_member(client, home_a)
    scope(raw_sql, home_a, home_a.member_id if forgery == "creator" else None)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO family_events (family_id,member_id,title,date,kind,activity_status) "
                "VALUES (:fid,:mid,'test','2026-11-15','activity','planned')"
            ),
            {
                "fid": home_a.family_id,
                "mid": child.member_id if forgery == "creator" else home_a.member_id,
            },
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()


@pytest.mark.parametrize(
    "assignment", ["member_id=NULL", "kind='event',activity_status=NULL", "family_id=:foreign"]
)
def test_database_activity_creator_kind_and_family_are_immutable(
    client, raw_sql, home_a, home_b, assignment
):
    item = create_activity(client, home_a)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(f"UPDATE family_events SET {assignment} WHERE id=:id"),  # noqa: S608
            {"id": item["id"], "foreign": home_b.family_id},
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()
    assert expect_status(get_activity(client, home_a, item), 200).json() == item


def test_database_participant_must_target_activity_and_active_same_family_member(
    client, raw_sql, home_a, home_b
):
    legacy = legacy_event(client, home_a)
    item = create_activity(client, home_a)
    suspended = add_active_member(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=:id"),
        {"id": suspended.member_id},
    )
    raw_sql.commit()
    for target_id, member_id in (
        (legacy["id"], home_a.member_id),
        (item["id"], home_b.member_id),
        (item["id"], suspended.member_id),
    ):
        scope(raw_sql, home_a, home_a.member_id)
        with pytest.raises(IntegrityError):
            raw_sql.execute(
                text(
                    "INSERT INTO activity_participants (activity_id,member_id,family_id) "
                    "VALUES (:aid,:mid,:fid)"
                ),
                {"aid": target_id, "mid": member_id, "fid": home_a.family_id},
            )
        raw_sql.rollback()


def test_database_participant_member_family_fk_prevents_member_move(
    client, raw_sql, home_a, home_b
):
    child = add_active_member(client, home_a)
    create_activity(client, home_a, participant_ids=[child.member_id])
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text("UPDATE members SET family_id=:fid WHERE id=:id"),
            {"fid": home_b.family_id, "id": child.member_id},
        )
    assert error.value.orig.diag.constraint_name == "fk_activity_participant_member_family"
    raw_sql.rollback()


def test_creator_deletion_preserves_activity_nulls_creator_and_removes_participation(
    client, home_a
):
    creator = add_active_member(client, home_a)
    item = create_activity(client, creator, participant_ids=[creator.member_id, home_a.member_id])
    expect_status(client.delete(f"{AUTH}/members/{creator.member_id}", headers=home_a.h), 200)
    saved = expect_status(get_activity(client, home_a, item), 200).json()
    assert saved["created_by"] is None and saved["participant_ids"] == [home_a.member_id]
    assert saved["revision"] > item["revision"] and saved["can_edit"]
    assert events(client, home_a)[0]["id"] == item["id"]
    expect_status(remove(client, home_a, saved), 204)


def test_activity_deletion_cascades_participants_and_preserves_members_legacy_events(
    client, raw_sql, home_a
):
    child = introduced(client, home_a)
    legacy = legacy_event(client, home_a)
    item = create_activity(client, home_a, participant_ids=[child["id"]])
    expect_status(remove(client, home_a, item), 204)
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM activity_participants")).scalar_one() == 0
    assert (
        raw_sql.execute(
            text("SELECT count(*) FROM members WHERE id=:id"), {"id": child["id"]}
        ).scalar_one()
        == 1
    )
    raw_sql.rollback()
    assert [row["id"] for row in events(client, home_a)] == [legacy["id"]]


def test_family_deletion_physically_removes_activity_and_participants(client, raw_sql, home_a):
    item = create_activity(client, home_a, participant_ids=[home_a.member_id])
    raw_sql.execute(text("DELETE FROM families WHERE id=:id"), {"id": home_a.family_id})
    raw_sql.commit()
    raw_sql.execute(
        text("INSERT INTO families (id,name,code) VALUES (:fid,'test','ACTIVITY-CASCADE')"),
        {"fid": home_a.family_id},
    )
    raw_sql.execute(
        text("INSERT INTO members (id,family_id,name,role) VALUES (:mid,:fid,'test','owner')"),
        {"mid": home_a.member_id, "fid": home_a.family_id},
    )
    raw_sql.commit()
    scope(raw_sql, home_a, home_a.member_id)
    assert (
        raw_sql.execute(
            text("SELECT count(*) FROM family_events WHERE id=:id"), {"id": item["id"]}
        ).scalar_one()
        == 0
    )
    assert raw_sql.execute(text("SELECT count(*) FROM activity_participants")).scalar_one() == 0
    raw_sql.rollback()


@pytest.mark.parametrize("state", ["suspended", "removed", "pending"])
def test_revoked_account_cannot_access_activity_or_calendar_routes(client, raw_sql, home_a, state):
    child = add_active_member(client, home_a)
    item = create_activity(client, child)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": child.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(ACTIVITIES, headers=child.h), 403)
    expect_status(get_activity(client, child, item), 403)
    expect_status(edit(client, child, item), 403)
    expect_status(remove(client, child, item), 403)
    expect_status(client.get(f"{API}/events", headers=child.h), 403)
    scope(raw_sql, home_a, child.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM family_events")).scalar_one() == 0
    raw_sql.rollback()


def test_activity_and_calendar_success_errors_are_no_store_without_other_domain_side_effects(
    client, home_a
):
    created = expect_status(
        client.post(ACTIVITIES, headers=home_a.h, json={"title": "برنامه", "date": "2026-11-15"}),
        201,
    )
    item = created.json()
    for response in (
        created,
        client.get(ACTIVITIES, headers=home_a.h),
        get_activity(client, home_a, item),
        edit(client, home_a, item),
        client.get(f"{API}/events", headers=home_a.h),
        client.get(ACTIVITIES),
        client.get(f"{API}/events"),
        client.post(ACTIVITIES, headers=home_a.h, json={"title": ""}),
        client.get(f"{ACTIVITIES}/{uuid.uuid4()}", headers=home_a.h),
        client.delete(f"{API}/events/{item['id']}", headers=home_a.h),
    ):
        assert response.headers["Cache-Control"] == "no-store"
    for path in ("transactions", "documents", "tasks"):
        assert expect_status(client.get(f"{API}/{path}", headers=home_a.h), 200).json() == []
    snapshot = expect_status(client.get(f"{API}/shopping/offline", headers=home_a.h), 200).json()
    assert "activities" not in snapshot and "activity_participants" not in snapshot


def test_activity_audit_omits_title_note_and_location(client, home_a, caplog):
    with caplog.at_level("INFO", logger="app.services.activities"):
        item = create_activity(
            client, home_a, title="عنوان محرمانه", note="توضیح محرمانه", location="مکان محرمانه"
        )
        item = expect_status(edit(client, home_a, item, status="done"), 200).json()
        expect_status(remove(client, home_a, item), 204)
    records = [
        record.getMessage() for record in caplog.records if record.name == "app.services.activities"
    ]
    assert any(item["id"] in record for record in records)
    assert all("محرمانه" not in record for record in records)
