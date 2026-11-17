"""Real HTTP/PostgreSQL tests for household tasks, permissions and replay safety."""

from __future__ import annotations

import base64
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from sqlalchemy import text

from tests.conftest import API, AUTH, add_active_member, expect_status
from tests.test_shopping_offline import mutation, send, snapshot

TASKS = f"{API}/tasks"
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


def create_task(client, actor, **fields):
    response = client.post(TASKS, headers=actor.h, json={"title": "تعویض فیلتر آب", **fields})
    expect_status(response, 201)
    return response.json()


def tasks_of(client, actor):
    response = client.get(TASKS, headers=actor.h)
    expect_status(response, 200)
    return response.json()


def edit_task(client, actor, task, **fields):
    body = {
        "title": task["title"],
        "description": task["description"],
        "assignee_id": task["assignee_id"],
        "due_date": task["due_date"],
        "base_revision": task["revision"],
        **fields,
    }
    return client.patch(f"{TASKS}/{task['id']}", headers=actor.h, json=body)


def complete_task(client, actor, task, completed=True, **fields):
    return client.post(
        f"{TASKS}/{task['id']}/complete",
        headers=actor.h,
        json={"base_revision": task["revision"], "completed": completed, **fields},
    )


def test_task_crud_and_completion_use_explicit_actor_fields(client, home_a):
    member = add_active_member(client, home_a)
    task = create_task(
        client,
        member,
        title="  تعویض   فیلتر  ",
        description="  هر شش ماه  ",
        assignee_id=home_a.member_id,
        due_date="2026-11-14",
    )
    assert task["title"] == "تعویض فیلتر"
    assert task["description"] == "هر شش ماه"
    assert task["created_by"] == member.member_id
    assert task["completed"] is False
    assert task["completed_at"] is None and task["completed_by"] is None
    assert task["revision"] == 1
    assert task["due_date"] == "2026-11-14"
    edited = expect_status(
        edit_task(client, member, task, assignee_id=member.member_id), 200
    ).json()
    assert edited["revision"] == 2
    done = expect_status(complete_task(client, member, edited), 200).json()
    assert done["completed"] and done["completed_at"] and done["completed_by"] == member.member_id
    assert done["revision"] == 3
    # Completing an already completed task acknowledges one revision without
    # replacing the original person's timestamp or identity.
    noop = expect_status(complete_task(client, home_a, done), 200).json()
    assert noop["revision"] == 4
    assert noop["completed_at"] == done["completed_at"]
    assert noop["completed_by"] == done["completed_by"]
    opened = expect_status(complete_task(client, member, noop, False), 200).json()
    assert opened["completed"] is False
    assert opened["completed_at"] is None and opened["completed_by"] is None
    expect_status(
        client.delete(
            f"{TASKS}/{task['id']}", headers=member.h, params={"base_revision": opened["revision"]}
        ),
        204,
    )
    assert tasks_of(client, home_a) == []


def test_task_permissions_creator_assignee_other_and_both_admins(client, home_a):
    creator = add_active_member(client, home_a, "سازنده")
    assignee = add_active_member(client, home_a, "مسئول")
    outsider = add_active_member(client, home_a, "عضو دیگر")
    second_admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(
        client.post(f"{AUTH}/members/{second_admin.member_id}/promote", headers=home_a.h), 200
    )
    task = create_task(client, creator, assignee_id=assignee.member_id)
    assert tasks_of(client, outsider)[0]["id"] == task["id"]
    for actor in (assignee, outsider):
        denied = expect_status(edit_task(client, actor, task, title="غیرمجاز"), 403).json()
        assert denied["error"] == "TASK_FORBIDDEN"
        expect_status(
            client.delete(f"{TASKS}/{task['id']}", headers=actor.h, params={"base_revision": 1}),
            403,
        )
    denied = expect_status(complete_task(client, outsider, task), 403).json()
    assert denied["error"] == "TASK_FORBIDDEN"
    task = expect_status(complete_task(client, assignee, task), 200).json()
    task = expect_status(complete_task(client, creator, task, False), 200).json()
    task = expect_status(edit_task(client, second_admin, task, title="ویرایش مدیر دوم"), 200).json()
    task = expect_status(complete_task(client, second_admin, task), 200).json()
    task = expect_status(edit_task(client, home_a, task, title="ویرایش مدیر اصلی"), 200).json()
    expect_status(
        client.delete(
            f"{TASKS}/{task['id']}",
            headers=second_admin.h,
            params={"base_revision": task["revision"]},
        ),
        204,
    )


def test_task_tenant_ids_cannot_be_read_changed_or_assigned(client, home_a, home_b):
    task = create_task(client, home_a)
    assert tasks_of(client, home_b) == []
    assert snapshot(client, home_b)["tasks"] == []
    expect_status(edit_task(client, home_b, task), 404)
    expect_status(complete_task(client, home_b, task), 404)
    expect_status(
        client.delete(f"{TASKS}/{task['id']}", headers=home_b.h, params={"base_revision": 1}), 404
    )
    response = client.post(
        TASKS, headers=home_a.h, json={"title": "کار", "assignee_id": home_b.member_id}
    )
    expect_status(response, 422)
    assert response.json()["error"] == "INVALID_ASSIGNEE"
    send(client, home_b, mutation("task.complete", task["id"], 1, completed=True), 404)
    assert tasks_of(client, home_a)[0]["completed"] is False


@pytest.mark.parametrize("state", ["pending", "suspended", "removed", "rejected", "expired"])
def test_inactive_assignee_rejected_for_online_and_offline(client, raw_sql, home_a, state):
    member = add_active_member(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": member.member_id},
    )
    raw_sql.commit()
    task = create_task(client, home_a)
    expect_status(edit_task(client, home_a, task, assignee_id=member.member_id), 422)
    result = send(
        client,
        home_a,
        mutation("task.create", str(uuid.uuid4()), None, title="کار", assignee_id=member.member_id),
        422,
    )
    assert result["error"] == "INVALID_ASSIGNEE"
    assert len(tasks_of(client, home_a)) == 1


@pytest.mark.parametrize(
    "extra",
    [
        {"created_by": str(uuid.uuid4())},
        {"family_id": str(uuid.uuid4())},
        {"completed": True},
        {"completed_at": "2026-11-14T00:00:00Z"},
        {"completed_by": str(uuid.uuid4())},
        {"revision": 4},
        {"due_date": 0},
        {"due_date": "2026-11-14T00:00:00Z"},
        {"due_date": "2026-02-30"},
        {"assignee_id": "not-a-uuid"},
        {"description": "x" * 2001},
        {"title": " "},
    ],
)
def test_task_inputs_cannot_spoof_tenant_actor_or_state(client, home_a, extra):
    response = client.post(TASKS, headers=home_a.h, json={"title": "کار", **extra})
    expect_status(response, 422)
    operation = mutation("task.create", str(uuid.uuid4()), None, title="کار")
    operation["payload"].update(extra)
    send(client, home_a, operation, 422)
    assert tasks_of(client, home_a) == []


def test_stale_versions_cannot_overwrite_complete_or_delete_task(client, home_a):
    task = create_task(client, home_a)
    current = expect_status(edit_task(client, home_a, task, title="نسخهٔ تازه"), 200).json()
    expect_status(edit_task(client, home_a, task, title="نسخهٔ قدیمی"), 409)
    expect_status(complete_task(client, home_a, task), 409)
    expect_status(
        client.delete(f"{TASKS}/{task['id']}", headers=home_a.h, params={"base_revision": 1}), 409
    )
    send(client, home_a, mutation("task.complete", task["id"], 1, completed=True), 409)
    assert tasks_of(client, home_a)[0] == current


def test_task_offline_creation_replay_complete_reopen_and_delete(client, home_a):
    task_id = str(uuid.uuid4())
    create = mutation(
        "task.create",
        task_id,
        None,
        title="کار آفلاین",
        assignee_id=home_a.member_id,
        due_date="2026-11-14",
        description="توضیح مشترک",
    )
    result = send(client, home_a, create)
    assert result["entity_type"] == "task" and result["revision"] == 1
    task = result["snapshot"]["tasks"][0]
    assert task["created_by"] == home_a.member_id
    assert set(task) == {
        "id",
        "title",
        "description",
        "assignee_id",
        "due_date",
        "completed",
        "completed_at",
        "completed_by",
        "completion_photo_url",
        "created_by",
        "revision",
        "created_at",
        "updated_at",
    }
    assert send(client, home_a, create)["replayed"] is True
    assert len(tasks_of(client, home_a)) == 1
    complete = mutation("task.complete", task_id, 1, completed=True)
    done = send(client, home_a, complete)["snapshot"]["tasks"][0]
    assert done["completed_by"] == home_a.member_id and done["revision"] == 2
    assert send(client, home_a, complete)["snapshot"]["tasks"][0] == done
    reopened = send(client, home_a, mutation("task.complete", task_id, 2, completed=False))[
        "snapshot"
    ]["tasks"][0]
    assert reopened["completed_at"] is None and reopened["completed_by"] is None
    delete = mutation("task.delete", task_id, 3)
    send(client, home_a, delete)
    assert send(client, home_a, delete)["replayed"] is True
    assert tasks_of(client, home_a) == []


def test_task_offline_retries_check_current_permissions(client, home_a):
    assignee = add_active_member(client, home_a)
    task = create_task(client, home_a, assignee_id=assignee.member_id)
    complete = mutation("task.complete", task["id"], 1, completed=True)
    send(client, assignee, complete)
    completed = tasks_of(client, home_a)[0]
    expect_status(edit_task(client, home_a, completed, assignee_id=home_a.member_id), 200)
    response = send(client, assignee, complete, 403)
    assert response["error"] == "TASK_FORBIDDEN"
    denied = send(client, assignee, mutation("task.update", task["id"], 3, title="ردشده"), 403)
    assert denied["error"] == "TASK_FORBIDDEN"
    assert tasks_of(client, home_a)[0]["title"] == task["title"]


def test_duplicate_task_operation_is_atomic_under_concurrent_requests(client, home_a):
    from fastapi.testclient import TestClient

    from app.main import app

    body = mutation("task.create", str(uuid.uuid4()), None, title="فقط یک‌بار")

    def submit(_):
        with TestClient(app) as concurrent_client:
            return send(concurrent_client, home_a, body)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(result["replayed"] for result in results) == [False, True]
    assert len(tasks_of(client, home_a)) == 1
    response = send(client, home_a, {**body, "payload": {"title": "تغییر شناسه"}}, 409)
    assert response["error"] == "OPERATION_REUSED"


def test_task_mutation_retains_existing_shopping_snapshot(client, home_a):
    from tests.test_shopping import new_list, new_stock

    shopping_list = new_list(client, home_a)
    stock = new_stock(client, home_a)
    before = snapshot(client, home_a)
    send(client, home_a, mutation("task.create", str(uuid.uuid4()), None, title="کار"))
    after = snapshot(client, home_a)
    assert after["lists"] == before["lists"]
    assert after["inventory"] == before["inventory"]
    assert after["lists"][0]["id"] == shopping_list["id"]
    assert after["inventory"][0]["id"] == stock["id"]


def test_offline_task_notification_prefs_persist_per_member_without_other_settings(client, home_a):
    member = add_active_member(client, home_a)
    prefs_path = f"{API}/notifications/prefs"
    expected = {"enabled": False, "tasks_enabled": False, "lead_days": 5}
    expect_status(
        client.patch(
            prefs_path,
            headers=member.h,
            json={
                "enabled": False,
                "domains": {"tasks": False, "event": False, "inventory": False},
                "lead_days": {"tasks": 5, "event": 14, "bills": 2},
            },
        ),
        200,
    )
    expect_status(
        client.post(
            f"{API}/notifications/dismissals",
            headers=member.h,
            json={"key": "event:private-member-key:2026-11-14"},
        ),
        204,
    )
    stored = expect_status(client.get(prefs_path, headers=member.h), 200).json()
    assert stored["domains"]["tasks"] is False and stored["lead_days"]["tasks"] == 5
    assert stored["dismissed"]
    narrow = snapshot(client, member)["task_notification_prefs"]
    assert narrow == expected
    assert set(narrow) == {"enabled", "tasks_enabled", "lead_days"}
    assert snapshot(client, home_a)["task_notification_prefs"] == {
        "enabled": True,
        "tasks_enabled": True,
        "lead_days": 0,
    }
    result = send(client, member, mutation("task.create", str(uuid.uuid4()), None, title="کار"))
    assert result["snapshot"]["task_notification_prefs"] == expected
    expect_status(client.patch(prefs_path, headers=member.h, json={"enabled": True}), 200)
    assert snapshot(client, member)["task_notification_prefs"] == {
        "enabled": True,
        "tasks_enabled": False,
        "lead_days": 5,
    }


@pytest.mark.parametrize("requested, expected", [(1000, 60), (-3, 0), (0, 0), (12, 12)])
def test_offline_task_notification_lead_matches_preference_clamping(
    client, home_a, requested, expected
):
    expect_status(
        client.patch(
            f"{API}/notifications/prefs", headers=home_a.h, json={"lead_days": {"tasks": requested}}
        ),
        200,
    )
    assert snapshot(client, home_a)["task_notification_prefs"]["lead_days"] == expected


def task_photo_files(task):
    from app.core.config import settings

    return list((Path(settings.storage_dir) / "task-photos").glob(f"*/{task['id']}/*"))


def assert_task_photo_served(client, task, photo=TINY_PNG):
    url = task["completion_photo_url"]
    assert url and "/task-photos/" in url and "?sig=" in url
    parsed = urlsplit(url)
    response = expect_status(client.get(f"{parsed.path}?{parsed.query}"), 200)
    assert response.headers["content-type"] == "image/png"
    assert response.content == base64.b64decode(photo.split(",", 1)[1])
    expect_status(client.get(parsed.path), 403)


def test_task_completion_photo_is_shared_preserved_on_noop_and_cleared_on_reopen(client, home_a):
    assignee = add_active_member(client, home_a, "مسئول")
    task = create_task(client, home_a, assignee_id=assignee.member_id)
    assert task["completion_photo_url"] is None
    done = expect_status(
        complete_task(client, assignee, task, completion_photo=TINY_PNG), 200
    ).json()
    assert done["completed"] and done["completed_by"] == assignee.member_id
    assert_task_photo_served(client, done)
    assert tasks_of(client, home_a)[0] == done
    assert snapshot(client, assignee)["tasks"][0] == done
    assert len(task_photo_files(task)) == 1

    noop = expect_status(complete_task(client, home_a, done), 200).json()
    assert noop["completion_photo_url"] == done["completion_photo_url"]
    assert noop["completed_at"] == done["completed_at"]
    assert noop["completed_by"] == done["completed_by"]
    repeated_photo = expect_status(
        complete_task(client, home_a, noop, completion_photo=TINY_PNG), 200
    ).json()
    assert repeated_photo["completion_photo_url"] == done["completion_photo_url"]
    assert repeated_photo["completed_by"] == assignee.member_id
    assert len(task_photo_files(task)) == 1

    reopened = expect_status(complete_task(client, assignee, repeated_photo, False), 200).json()
    assert reopened["completed"] is False
    assert reopened["completion_photo_url"] is None
    assert reopened["completed_by"] is None and reopened["completed_at"] is None
    again = expect_status(complete_task(client, assignee, reopened), 200).json()
    assert again["completion_photo_url"] is None


def test_queued_task_completion_photo_replay_stores_one_file_and_preserves_revision(client, home_a):
    task = create_task(client, home_a)
    operation = mutation(
        "task.complete", task["id"], task["revision"],
        completed=True, completion_photo=TINY_PNG,
    )
    result = send(client, home_a, operation)
    done = result["snapshot"]["tasks"][0]
    assert done["revision"] == 2 and done["completed_by"] == home_a.member_id
    assert_task_photo_served(client, done)
    replay = send(client, home_a, operation)
    assert replay["replayed"] is True and replay["snapshot"]["tasks"][0] == done
    assert len(task_photo_files(task)) == 1
    reopened = send(client, home_a, mutation("task.complete", task["id"], 2, completed=False))[
        "snapshot"
    ]["tasks"][0]
    assert reopened["completion_photo_url"] is None


@pytest.mark.parametrize(
    "photo",
    [
        "", "not-an-image", "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,%%%", "data:image/png;base64,AAAAA",
    ],
)
def test_invalid_task_completion_photo_does_not_complete_or_store_file(client, home_a, photo):
    task = create_task(client, home_a)
    response = expect_status(complete_task(client, home_a, task, completion_photo=photo), 400)
    assert response.json()["error"] == "INVALID_IMAGE"
    send(client, home_a, mutation(
        "task.complete", task["id"], 1, completed=True, completion_photo=photo,
    ), 400)
    assert tasks_of(client, home_a)[0] == task
    assert task_photo_files(task) == []


def test_task_completion_photo_respects_configured_decoded_size_limit(client, home_a, monkeypatch):
    from app.core.config import settings

    task = create_task(client, home_a)
    monkeypatch.setattr(settings, "upload_max_bytes", 32)
    response = expect_status(complete_task(client, home_a, task, completion_photo=TINY_PNG), 400)
    assert response.json()["error"] == "IMAGE_TOO_LARGE"
    denied = send(client, home_a, mutation(
        "task.complete", task["id"], 1, completed=True, completion_photo=TINY_PNG,
    ), 400)
    assert denied["error"] == "IMAGE_TOO_LARGE"
    assert tasks_of(client, home_a)[0] == task
    assert task_photo_files(task) == []


def test_task_completion_photo_requires_completion_and_cannot_be_spoofed_as_url(client, home_a):
    task = create_task(client, home_a)
    for photo in (TINY_PNG, ""):
        expect_status(complete_task(client, home_a, task, False, completion_photo=photo), 422)
        send(client, home_a, mutation(
            "task.complete", task["id"], 1, completed=False, completion_photo=photo,
        ), 422)
    expect_status(complete_task(
        client, home_a, task, completion_photo_url="https://example.com/photo.png",
    ), 422)
    send(client, home_a, mutation(
        "task.complete", task["id"], 1, completed=True,
        completion_photo_url="https://example.com/photo.png",
    ), 422)
    assert tasks_of(client, home_a)[0] == task
    assert task_photo_files(task) == []


def test_task_photo_permissions_and_conflicts_checked_before_storage(client, home_a, home_b):
    creator = add_active_member(client, home_a, "سازنده")
    outsider = add_active_member(client, home_a, "عضو دیگر")
    task = create_task(client, creator)
    for actor, status_code in ((outsider, 403), (home_b, 404)):
        expect_status(complete_task(client, actor, task, completion_photo=TINY_PNG), status_code)
        send(client, actor, mutation(
            "task.complete", task["id"], 1, completed=True, completion_photo=TINY_PNG,
        ), status_code)
    current = expect_status(edit_task(client, creator, task, title="نسخهٔ تازه"), 200).json()
    expect_status(complete_task(client, creator, task, completion_photo=TINY_PNG), 409)
    send(client, creator, mutation(
        "task.complete", task["id"], 1, completed=True, completion_photo=TINY_PNG,
    ), 409)
    assert tasks_of(client, home_a)[0] == current
    assert task_photo_files(task) == []
