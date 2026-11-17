"""Canonical children, shared summaries, profile races, and birthday reconciliation."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text

from tests.conftest import API, AUTH, add_active_member, expect_status, next_phone
from tests.test_shopping_offline import mutation, send, snapshot
from tests.test_tasks import create_task, edit_task

CHILDREN = f"{API}/children"
_CHILD_FIELDS = {"id", "name", "birth_date", "age_years", "status", "revision", "can_edit"}


def create_child(client, actor, **fields):
    return expect_status(
        client.post(
            CHILDREN,
            headers=actor.h,
            json={
                "name": "آراد",
                "birth_date": None,
                **fields,
            },
        ),
        201,
    ).json()


def listed(client, actor):
    return expect_status(client.get(CHILDREN, headers=actor.h), 200).json()


def detail(client, actor, child):
    return client.get(f"{CHILDREN}/{child['id']}", headers=actor.h)


def edit(client, actor, child, **fields):
    return client.patch(
        f"{CHILDREN}/{child['id']}",
        headers=actor.h,
        json={
            "name": child["name"],
            "birth_date": child["birth_date"],
            "base_revision": child["revision"],
            **fields,
        },
    )


def calendar(client, actor):
    return expect_status(client.get(f"{API}/events", headers=actor.h), 200).json()


def activity(client, actor, child, **fields):
    return expect_status(
        client.post(
            f"{API}/activities",
            headers=actor.h,
            json={
                "title": "برنامهٔ مشترک",
                "date": "2026-11-15",
                "participant_ids": [child["id"]],
                **fields,
            },
        ),
        201,
    ).json()


def scope(conn, actor):
    conn.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": actor.family_id, "mid": actor.member_id},
    )


def test_phoneless_child_is_one_canonical_member_with_minimized_outputs(client, raw_sql, home_a):
    child = create_child(client, home_a, name="  آراد   خانه  ")
    assert set(child) == _CHILD_FIELDS
    assert child["name"] == "آراد خانه" and child["status"] == "pending"
    assert child["birth_date"] is None and child["age_years"] is None
    assert child["revision"] == 1 and child["can_edit"]
    assert listed(client, home_a) == {"children": [child], "can_create": True}
    assert expect_status(detail(client, home_a, child), 200).json() == {
        "child": child,
        "tasks": [],
        "activities": [],
        "birthday": None,
    }
    members = expect_status(client.get(f"{AUTH}/members", headers=home_a.h), 200).json()
    member = next(row for row in members if row["id"] == child["id"])
    assert member["phone"] is None and member["relation"] == "فرزند"
    assert member["membership_state"] == "active" and member["role"] == "member"
    assert len(members) == 2
    row = raw_sql.execute(
        text("SELECT phone,password_hash,profile_revision FROM members WHERE id=:id"),
        {"id": child["id"]},
    ).one()
    assert tuple(row) == (None, None, 1)
    assert calendar(client, home_a) == []
    for path in ("transactions", "documents", "tasks"):
        assert expect_status(client.get(f"{API}/{path}", headers=home_a.h), 200).json() == []
    assert expect_status(client.get(f"{API}/goals", headers=home_a.h), 200).json()["goals"] == []
    expect_status(
        client.post(
            f"{AUTH}/members", headers=home_a.h, json={"name": "عضو دیگر", "relation": "فرزند"}
        ),
        422,
    )
    expect_status(client.delete(f"{CHILDREN}/{child['id']}", headers=home_a.h), 405)


def test_birth_date_age_and_birthday_follow_same_jalali_anniversary(client, home_a, monkeypatch):
    from app.services.birthday_dates import age_years_on_day, next_birthday_occurrence

    monkeypatch.setattr(
        "app.services.member_age.utcnow", lambda: datetime(2026, 11, 15, tzinfo=UTC)
    )
    child = create_child(client, home_a, birth_date="2015-01-10")
    assert child["age_years"] == age_years_on_day(date(2015, 1, 10), date(2026, 11, 15))
    birthday = expect_status(detail(client, home_a, child), 200).json()["birthday"]
    assert birthday["title"] == "تولد آراد"
    assert (
        birthday["date"]
        == next_birthday_occurrence(date(2015, 1, 10), date(2026, 11, 15)).isoformat()
    )
    assert birthday["date"] >= "2026-11-15"
    events = calendar(client, home_a)
    assert len(events) == 1 and events[0]["id"] == birthday["id"]
    assert events[0]["for_member_id"] == child["id"] and events[0]["kind"] == "event"
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    assert expect_status(detail(client, home_a, child), 200).json()["birthday"] == birthday
    assert len(calendar(client, home_a)) == 1


def test_child_edit_reuses_birthday_id_and_clearing_birth_removes_only_birthday(client, home_a):
    child = create_child(client, home_a, birth_date="2015-01-10")
    birthday = expect_status(detail(client, home_a, child), 200).json()["birthday"]
    program = activity(client, home_a, child, title="تولد آراد")
    legacy = expect_status(
        client.post(
            f"{API}/events", headers=home_a.h, json={"title": "مناسبت دیگر", "date": "2026-12-20"}
        ),
        201,
    ).json()
    changed = expect_status(
        edit(client, home_a, child, name="نام جدید", birth_date="2016-03-20"), 200
    ).json()
    assert changed["revision"] == child["revision"] + 1
    new_birthday = expect_status(detail(client, home_a, changed), 200).json()["birthday"]
    assert new_birthday["id"] == birthday["id"] and new_birthday["title"] == "تولد نام جدید"
    expect_status(edit(client, home_a, child, name="نسخهٔ قدیمی"), 409)
    noop = expect_status(edit(client, home_a, changed), 200).json()
    assert noop["revision"] == changed["revision"] + 1
    changed = expect_status(edit(client, home_a, noop, birth_date=None), 200).json()
    current = expect_status(detail(client, home_a, changed), 200).json()
    assert current["birthday"] is None and current["child"]["age_years"] is None
    assert [row["id"] for row in current["activities"]] == [program["id"]]
    assert {row["id"] for row in calendar(client, home_a)} == {program["id"], legacy["id"]}


def test_all_active_family_accounts_read_but_only_managers_write(client, home_a):
    other = add_active_member(client, home_a)
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    child = create_child(client, home_a)
    own_account = expect_status(detail(client, other, child), 200).json()
    assert not own_account["child"]["can_edit"] and not listed(client, other)["can_create"]
    expect_status(
        client.post(CHILDREN, headers=other.h, json={"name": "کودک", "birth_date": None}), 403
    )
    expect_status(edit(client, other, child, name="غیرمجاز"), 403)
    changed = expect_status(edit(client, admin, child, name="مدیر دوم"), 200).json()
    assert changed["can_edit"]
    existing = next(
        row for row in listed(client, home_a)["children"] if row["id"] == other.member_id
    )
    assert existing["status"] == "active"
    expect_status(detail(client, other, existing), 200)
    expect_status(edit(client, other, existing, name="تغییر توسط کودک"), 403)


def test_cross_family_and_non_child_ids_never_resolve(client, home_a, home_b):
    child = create_child(client, home_a)
    assert listed(client, home_b)["children"] == []
    expect_status(detail(client, home_b, child), 404)
    expect_status(edit(client, home_b, child), 404)
    expect_status(client.get(f"{CHILDREN}/{home_a.member_id}", headers=home_a.h), 404)
    expect_status(client.get(f"{CHILDREN}/{uuid.uuid4()}", headers=home_a.h), 404)


def test_detail_uses_only_assigned_tasks_and_selected_activities_without_private_text(
    client, raw_sql, home_a
):
    child = create_child(client, home_a)
    other = create_child(client, home_a, name="فرزند دیگر")
    task = create_task(client, home_a, assignee_id=child["id"], description="متن خصوصی نمونه")
    create_task(client, home_a, assignee_id=other["id"], title="کار فرزند دیگر")
    create_task(client, home_a, title="کار بدون مسئول")
    program = activity(client, home_a, child, location="پارک", note="یادداشت برنامه")
    activity(client, home_a, other, title="برنامهٔ فرزند دیگر")
    expect_status(
        client.post(
            f"{API}/goals", headers=home_a.h, json={"title": "آرزوی شخصی محرمانه", "kind": "wish"}
        ),
        201,
    )
    scope(raw_sql, home_a)
    raw_sql.execute(
        text(
            "UPDATE tasks SET completion_photo_url='urn:test:private-photo',completed=true, "
            "completed_at=now(),completed_by=:mid WHERE id=:id"
        ),
        {"id": task["id"], "mid": home_a.member_id},
    )
    raw_sql.commit()
    current = expect_status(detail(client, home_a, child), 200).json()
    assert current["tasks"] == [
        {"id": task["id"], "title": task["title"], "due_date": None, "completed": True}
    ]
    assert current["activities"] == [
        {
            "id": program["id"],
            "title": program["title"],
            "date": program["date"],
            "location": "پارک",
            "status": "planned",
        }
    ]
    assert set(current) == {"child", "tasks", "activities", "birthday"}
    for forbidden in (
        "متن خصوصی",
        "یادداشت برنامه",
        "آرزوی شخصی",
        "private-photo",
        "password_hash",
        "document_access_not_before",
        "description",
        "completion_photo_url",
        "phone",
        "family_id",
    ):
        assert forbidden not in str(current)
    assert "children" not in snapshot(client, home_a)


def test_pending_children_accept_direct_and_offline_task_assignments(client, home_a):
    child = create_child(client, home_a)
    direct = create_task(client, home_a, assignee_id=child["id"], due_date="2026-11-15")
    queued_id = str(uuid.uuid4())
    queued = mutation(
        "task.create", queued_id, None, title="کار کودک آفلاین", assignee_id=child["id"]
    )
    response = send(client, home_a, queued)
    assert response["entity_id"] == queued_id and send(client, home_a, queued)["replayed"]
    assert {
        row["id"] for row in expect_status(detail(client, home_a, child), 200).json()["tasks"]
    } == {direct["id"], queued_id}
    other_task = create_task(client, home_a)
    changed = expect_status(
        edit_task(client, home_a, other_task, assignee_id=child["id"]), 200
    ).json()
    send(
        client,
        home_a,
        mutation(
            "task.update",
            changed["id"],
            changed["revision"],
            title=changed["title"],
            assignee_id=child["id"],
            due_date=None,
            description=None,
        ),
    )
    assert len(expect_status(detail(client, home_a, child), 200).json()["tasks"]) == 3


def test_pending_non_child_and_cross_family_are_not_task_assignees(client, home_a, home_b):
    non_child = expect_status(
        client.post(
            f"{AUTH}/members",
            headers=home_a.h,
            json={"name": "معرفی‌شده", "phone": next_phone(), "relation": "سایر"},
        ),
        200,
    ).json()
    foreign = create_child(client, home_b)
    for member_id in (non_child["id"], foreign["id"]):
        expect_status(
            client.post(
                f"{API}/tasks", headers=home_a.h, json={"title": "کار", "assignee_id": member_id}
            ),
            422,
        )
        send(
            client,
            home_a,
            mutation("task.create", str(uuid.uuid4()), None, title="کار", assignee_id=member_id),
            422,
        )


@pytest.mark.parametrize("state", ["pending", "suspended", "removed", "rejected", "expired"])
def test_inactive_children_hidden_and_rejected_online_and_offline(client, raw_sql, home_a, state):
    child = create_child(client, home_a, birth_date="2015-01-10")
    task = create_task(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": child["id"]},
    )
    raw_sql.commit()
    assert listed(client, home_a)["children"] == []
    expect_status(detail(client, home_a, child), 404)
    expect_status(edit(client, home_a, child), 404)
    expect_status(edit_task(client, home_a, task, assignee_id=child["id"]), 422)
    send(
        client,
        home_a,
        mutation("task.create", str(uuid.uuid4()), None, title="کار", assignee_id=child["id"]),
        422,
    )
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    assert calendar(client, home_a) == []


@pytest.mark.parametrize("state", ["pending", "suspended", "removed"])
def test_revoked_actor_cannot_read_or_write_children(client, raw_sql, home_a, state):
    actor = add_active_member(client, home_a)
    child = create_child(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": actor.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(CHILDREN, headers=actor.h), 403)
    expect_status(detail(client, actor, child), 403)
    expect_status(edit(client, actor, child), 403)
    expect_status(
        client.post(CHILDREN, headers=actor.h, json={"name": "نام", "birth_date": None}), 403
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"name": " "},
        {"name": None},
        {"name": "x" * 41},
        {"birth_date": True},
        {"birth_date": 0},
        {"birth_date": "2026-02-30"},
        {"birth_date": "2026-11-15T00:00:00Z"},
        {"birth_date": "9999-12-31"},
        {"birth_date": "0001-01-01"},
        {"phone": "09121234567"},
        {"family_id": str(uuid.uuid4())},
        {"role": "admin"},
        {"status": "active"},
        {"relation": "سایر"},
        {"revision": 1},
        {"profile_revision": 1},
        {"avatar_url": "test"},
        {"notes": "متن"},
        {"goals": []},
    ],
)
def test_invalid_or_extra_child_fields_do_not_persist(client, home_a, fields):
    expect_status(
        client.post(
            CHILDREN, headers=home_a.h, json={"name": "کودک", "birth_date": None, **fields}
        ),
        422,
    )
    assert listed(client, home_a)["children"] == []
    assert calendar(client, home_a) == []


@pytest.mark.parametrize("revision", [True, "1", 0, -1, 1.5, None])
def test_revision_is_a_strict_positive_integer(client, home_a, revision):
    child = create_child(client, home_a)
    expect_status(edit(client, home_a, child, base_revision=revision), 422)
    assert expect_status(detail(client, home_a, child), 200).json()["child"] == child


def test_concurrent_same_revision_profile_changes_have_one_winner(client, home_a):
    child = create_child(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda name: edit(client, home_a, child, name=name), ["اول", "دوم"])
        )
    assert sorted(row.status_code for row in responses) == [200, 409]
    winner = next(row.json() for row in responses if row.status_code == 200)
    assert expect_status(detail(client, home_a, child), 200).json()["child"] == winner


def test_legacy_profile_and_relation_changes_invalidate_child_revision_and_update_birthday(
    client, home_a
):
    actor = add_active_member(client, home_a, "کودک حساب‌دار")
    before = next(row for row in listed(client, home_a)["children"] if row["id"] == actor.member_id)
    expect_status(
        client.patch(
            f"{API}/members/me",
            headers=actor.h,
            json={"name": "نام پروفایل", "birth_date": "2010-01-10"},
        ),
        200,
    )
    current = expect_status(detail(client, home_a, before), 200).json()
    assert current["child"]["revision"] > before["revision"]
    assert current["birthday"]["title"] == "تولد نام پروفایل"
    expect_status(edit(client, home_a, before), 409)
    birthday_id = current["birthday"]["id"]
    expect_status(
        client.patch(
            f"{API}/members/me",
            headers=actor.h,
            json={"name": "نام پروفایل دوم", "birth_date": "2011-02-01"},
        ),
        200,
    )
    after = expect_status(detail(client, home_a, before), 200).json()
    assert (
        after["birthday"]["id"] == birthday_id
        and after["birthday"]["title"] == "تولد نام پروفایل دوم"
    )
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=home_a.h, json={"relation": "سایر"}
        ),
        200,
    )
    expect_status(detail(client, home_a, before), 404)
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation",
            headers=home_a.h,
            json={"relation": "فرزند"},
        ),
        200,
    )
    restored = expect_status(detail(client, home_a, before), 200).json()["child"]
    assert restored["revision"] > after["child"]["revision"]
    expect_status(edit(client, home_a, after["child"]), 409)


def test_profile_edits_never_weaken_existing_document_age_history(client, raw_sql, home_a):
    child = create_child(client, home_a, birth_date="2015-01-10")
    original = raw_sql.execute(
        text("SELECT document_access_not_before FROM members WHERE id=:id"), {"id": child["id"]}
    ).scalar_one()
    raw_sql.rollback()
    changed = expect_status(edit(client, home_a, child, birth_date="1980-01-01"), 200).json()
    saved = raw_sql.execute(
        text("SELECT document_access_not_before FROM members WHERE id=:id"), {"id": child["id"]}
    ).scalar_one()
    assert saved == original
    raw_sql.rollback()
    changed = expect_status(edit(client, home_a, changed, birth_date=None), 200).json()
    saved = raw_sql.execute(
        text("SELECT document_access_not_before FROM members WHERE id=:id"), {"id": child["id"]}
    ).scalar_one()
    assert saved == date.max
    raw_sql.rollback()
    expect_status(edit(client, home_a, changed, birth_date="1980-01-01"), 200)
    assert (
        raw_sql.execute(
            text("SELECT document_access_not_before FROM members WHERE id=:id"), {"id": child["id"]}
        ).scalar_one()
        == date.max
    )


def test_stale_legacy_profile_refreshes_stronger_manager_age_history(client, raw_sql, home_a):
    from app.db.session import SessionLocal
    from app.models.family import Member
    from app.schemas.data import MemberProfileUpdate
    from app.services.family import update_member_profile

    account = add_active_member(client, home_a)
    raw_sql.execute(
        text(
            "UPDATE members SET birth_date='1980-01-01',document_access_not_before=NULL "
            "WHERE id=:id"
        ),
        {"id": account.member_id},
    )
    raw_sql.commit()
    child = next(
        row for row in listed(client, home_a)["children"] if row["id"] == account.member_id
    )
    with SessionLocal() as db:
        stale_actor = db.get(Member, uuid.UUID(account.member_id))
        assert stale_actor.document_access_not_before is None
        changed = expect_status(edit(client, home_a, child, birth_date="2015-01-10"), 200).json()
        protected = raw_sql.execute(
            text("SELECT document_access_not_before FROM members WHERE id=:id"),
            {"id": account.member_id},
        ).scalar_one()
        raw_sql.rollback()
        assert protected is not None
        update_member_profile(
            db,
            stale_actor,
            MemberProfileUpdate(
                name="نام درخواست قدیمی",
                birth_date=date(1980, 1, 1),
            ),
        )
        assert stale_actor.document_access_not_before == protected
        assert stale_actor.profile_revision == changed["revision"] + 1
    current = expect_status(detail(client, home_a, child), 200).json()
    assert current["birthday"]["title"] == "تولد نام درخواست قدیمی"


def test_birthday_cleanup_removes_duplicates_and_phantoms_preserving_activity(
    client, raw_sql, home_a
):
    child = create_child(client, home_a, birth_date="2015-01-10")
    birthday = expect_status(detail(client, home_a, child), 200).json()["birthday"]
    program = activity(client, home_a, child, title="تولد آراد")
    scope(raw_sql, home_a)
    raw_sql.execute(
        text(
            "INSERT INTO family_events (family_id,member_id,for_member_id,title,date) "
            "VALUES (:fid,:mid,:cid,'تولد تکراری','2026-12-31')"
        ),
        {"fid": home_a.family_id, "mid": home_a.member_id, "cid": child["id"]},
    )
    raw_sql.commit()
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    rows = [row for row in calendar(client, home_a) if row["for_member_id"] == child["id"]]
    assert len(rows) == 1 and rows[0]["id"] == birthday["id"]
    expect_status(client.delete(f"{AUTH}/members/{child['id']}", headers=home_a.h), 200)
    assert listed(client, home_a)["children"] == []
    assert [row["id"] for row in calendar(client, home_a)] == [program["id"]]
    program_now = expect_status(
        client.get(f"{API}/activities/{program['id']}", headers=home_a.h), 200
    ).json()
    assert program_now["participant_ids"] == []


def test_sync_skips_stale_member_deleted_before_lock(client, home_a):
    from app.db.session import SessionLocal
    from app.models.family import Member
    from app.services.events import reconcile_member_birthday

    child = create_child(client, home_a, birth_date="2015-01-10")
    with SessionLocal() as db:
        actor = db.get(Member, uuid.UUID(home_a.member_id))
        stale = db.get(Member, uuid.UUID(child["id"]))
        expect_status(client.delete(f"{AUTH}/members/{child['id']}", headers=home_a.h), 200)
        assert reconcile_member_birthday(db, actor, stale) is False
        db.commit()
    assert calendar(client, home_a) == []


def test_noncommitting_birthday_helper_is_idempotent_and_rolls_back_with_profile(client, home_a):
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.family import Member
    from app.services.events import reconcile_member_birthday

    child = create_child(client, home_a)
    with SessionLocal() as db:
        actor = db.get(Member, uuid.UUID(home_a.member_id))
        member = db.scalar(
            select(Member).where(Member.id == uuid.UUID(child["id"])).with_for_update()
        )
        member.birth_date = date(2015, 1, 10)
        assert reconcile_member_birthday(db, actor, member)
        assert not reconcile_member_birthday(db, actor, member)
        db.rollback()
    assert expect_status(detail(client, home_a, child), 200).json()["child"]["birth_date"] is None
    assert calendar(client, home_a) == []


@pytest.mark.parametrize(
    "assignment",
    [
        "name='نام جدید'",
        "birth_date='2010-01-10'",
        "relation='سایر'",
        "status='active'",
        "membership_state='suspended'",
    ],
)
def test_database_trigger_tracks_legacy_relevant_profile_writes(
    client, raw_sql, home_a, assignment
):
    child = create_child(client, home_a)
    raw_sql.execute(text(f"UPDATE members SET {assignment} WHERE id=:id"), {"id": child["id"]})  # noqa: S608
    raw_sql.commit()
    assert (
        raw_sql.execute(
            text("SELECT profile_revision FROM members WHERE id=:id"), {"id": child["id"]}
        ).scalar_one()
        == child["revision"] + 1
    )


def test_preferences_do_not_change_child_profile_revision_and_legacy_invalid_date_is_safe(
    client, raw_sql, home_a
):
    child = create_child(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET theme='dark',currency='ریال' WHERE id=:id"), {"id": child["id"]}
    )
    raw_sql.commit()
    assert (
        expect_status(detail(client, home_a, child), 200).json()["child"]["revision"]
        == child["revision"]
    )
    raw_sql.execute(
        text("UPDATE members SET birth_date='0001-01-01' WHERE id=:id"), {"id": child["id"]}
    )
    raw_sql.commit()
    expect_status(client.post(f"{API}/events/sync-birthdays", headers=home_a.h), 200)
    current = expect_status(detail(client, home_a, child), 200).json()
    assert current["child"]["age_years"] is None and current["birthday"] is None


def test_children_success_and_errors_have_no_store_and_audit_omits_profile_text(
    client, home_a, caplog
):
    with caplog.at_level("INFO", logger="app.services.children"):
        created = expect_status(
            client.post(
                CHILDREN, headers=home_a.h, json={"name": "نام محرمانه", "birth_date": "2015-01-10"}
            ),
            201,
        )
        child = created.json()
        changed = expect_status(edit(client, home_a, child, name="نام محرمانهٔ جدید"), 200)
    for response in (
        created,
        changed,
        client.get(CHILDREN, headers=home_a.h),
        detail(client, home_a, child),
        client.get(CHILDREN),
        client.get(f"{CHILDREN}/{uuid.uuid4()}", headers=home_a.h),
        client.post(CHILDREN, headers=home_a.h, json={"name": ""}),
    ):
        assert response.headers["Cache-Control"] == "no-store"
    records = [
        record.getMessage() for record in caplog.records if record.name == "app.services.children"
    ]
    assert any(child["id"] in row for row in records)
    assert all("محرمانه" not in row and "2015-01-10" not in row for row in records)
