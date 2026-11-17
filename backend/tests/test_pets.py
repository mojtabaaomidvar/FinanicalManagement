"""Pets retain canonical care Task identity and the established offline contract."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.conftest import API, AUTH, add_active_member, expect_status
from tests.test_shopping_offline import mutation, send, snapshot
from tests.test_tasks import complete_task, create_task, edit_task, tasks_of

PETS = f"{API}/pets"
_PROFILE_FIELDS = ("name", "species", "breed", "birth_date")
_PET_OUTPUT = {
    "id",
    "name",
    "species",
    "breed",
    "birth_date",
    "revision",
    "created_at",
    "updated_at",
    "can_edit",
    "can_delete",
}
_CARE_OUTPUT = {"id", "title", "assignee_id", "due_date", "completed", "revision", "can_complete"}


def create_pet(client, actor, **fields):
    return expect_status(
        client.post(
            PETS,
            headers=actor.h,
            json={
                "name": "برفی",
                "species": "گربه",
                "birth_date": None,
                **fields,
            },
        ),
        201,
    ).json()


def listed(client, actor):
    return expect_status(client.get(PETS, headers=actor.h), 200).json()


def detail(client, actor, pet):
    return client.get(f"{PETS}/{pet['id']}", headers=actor.h)


def edit(client, actor, pet, **fields):
    return client.patch(
        f"{PETS}/{pet['id']}",
        headers=actor.h,
        json={
            **{key: pet[key] for key in _PROFILE_FIELDS},
            "base_revision": pet["revision"],
            **fields,
        },
    )


def remove(client, actor, pet):
    return client.delete(
        f"{PETS}/{pet['id']}", headers=actor.h, params={"base_revision": pet["revision"]}
    )


def care_body(pet, **fields):
    return {
        "title": "غذا دادن",
        "base_revision": pet["revision"],
        "operation_id": str(uuid.uuid4()),
        **fields,
    }


def care(client, actor, pet, body=None, **fields):
    return client.post(
        f"{PETS}/{pet['id']}/care-tasks", headers=actor.h, json=body or care_body(pet, **fields)
    )


def scope(conn, actor, member_id=None):
    conn.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": actor.family_id, "mid": member_id or ""},
    )


def raw_pet_id(conn, actor, task_id):
    scope(conn, actor, actor.member_id)
    value = conn.execute(
        text("SELECT pet_id FROM tasks WHERE id=:id"), {"id": task_id}
    ).scalar_one()
    conn.rollback()
    return str(value) if value else None


def test_pet_crud_normalizes_fields_defaults_and_optimistic_revision(client, home_a):
    pet = create_pet(
        client, home_a, name="  برفی   خانه  ", species="  گربه   خانگی ", breed="  مو   بلند "
    )
    assert set(pet) == _PET_OUTPUT
    assert (
        pet["name"] == "برفی خانه" and pet["species"] == "گربه خانگی" and pet["breed"] == "مو بلند"
    )
    assert (
        pet["birth_date"] is None and pet["revision"] == 1 and pet["can_edit"] and pet["can_delete"]
    )
    assert listed(client, home_a) == {"pets": [pet], "can_create": True}
    assert expect_status(detail(client, home_a, pet), 200).json() == {
        "pet": pet,
        "care_tasks": [],
        "can_create_care": True,
    }
    changed = expect_status(
        edit(client, home_a, pet, name="نام جدید", birth_date="2020-01-10", breed=" "), 200
    ).json()
    assert (
        changed["revision"] == 2
        and changed["birth_date"] == "2020-01-10"
        and changed["breed"] is None
    )
    expect_status(edit(client, home_a, pet, name="نسخهٔ قدیمی"), 409)
    expect_status(remove(client, home_a, pet), 409)
    noop = expect_status(edit(client, home_a, changed), 200).json()
    assert noop["revision"] == changed["revision"] + 1
    expect_status(remove(client, home_a, noop), 204)
    assert listed(client, home_a)["pets"] == []
    expect_status(detail(client, home_a, pet), 404)


def test_active_children_and_other_members_read_managers_only_write(client, home_a):
    other = add_active_member(client, home_a)
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    pet = create_pet(client, admin)
    viewed = expect_status(detail(client, other, pet), 200).json()
    assert not viewed["pet"]["can_edit"] and not viewed["pet"]["can_delete"]
    assert not viewed["can_create_care"] and not listed(client, other)["can_create"]
    expect_status(
        client.post(
            PETS, headers=other.h, json={"name": "حیوان", "species": "سگ", "birth_date": None}
        ),
        403,
    )
    expect_status(edit(client, other, pet), 403)
    expect_status(remove(client, other, pet), 403)
    expect_status(care(client, other, pet), 403)
    pet = expect_status(edit(client, home_a, pet, name="ویرایش مدیر"), 200).json()
    expect_status(care(client, admin, pet), 201)
    expect_status(remove(client, admin, pet), 204)


def test_foreign_pet_and_task_ids_do_not_resolve_or_mutate(client, home_a, home_b):
    pet = create_pet(client, home_a)
    assert listed(client, home_b)["pets"] == []
    for response in (
        detail(client, home_b, pet),
        edit(client, home_b, pet),
        remove(client, home_b, pet),
        care(client, home_b, pet),
    ):
        expect_status(response, 404)
    response = care(client, home_a, pet, assignee_id=home_b.member_id)
    expect_status(response, 422)
    assert expect_status(detail(client, home_a, pet), 200).json()["care_tasks"] == []


def test_care_is_one_canonical_task_and_pet_revision_is_independent(client, raw_sql, home_a):
    pet = create_pet(client, home_a)
    body = care_body(
        pet,
        title="  غذا   دادن ",
        assignee_id=home_a.member_id,
        due_date="2026-11-15",
        description="توضیح کار",
    )
    created = expect_status(care(client, home_a, pet, body), 201).json()
    assert set(created) == _CARE_OUTPUT and created["id"] == body["operation_id"]
    assert created["title"] == "غذا دادن" and created["revision"] == 1 and created["can_complete"]
    task = tasks_of(client, home_a)[0]
    assert task["id"] == created["id"] and task["created_by"] == home_a.member_id
    assert task["assignee_id"] == created["assignee_id"] and task["description"] == "توضیح کار"
    assert "pet_id" not in task and raw_pet_id(raw_sql, home_a, task["id"]) == pet["id"]
    current = expect_status(detail(client, home_a, pet), 200).json()
    assert current["care_tasks"] == [created] and current["pet"]["revision"] == pet["revision"]
    assert len(tasks_of(client, home_a)) == 1


def test_care_retry_returns_current_task_after_completion_and_profile_edit(client, home_a):
    pet = create_pet(client, home_a)
    body = care_body(pet, assignee_id=home_a.member_id)
    first = expect_status(care(client, home_a, pet, body), 201).json()
    task = tasks_of(client, home_a)[0]
    done = expect_status(complete_task(client, home_a, task), 200).json()
    changed_pet = expect_status(edit(client, home_a, pet, name="نام جدید"), 200).json()
    retried = expect_status(
        care(client, home_a, changed_pet, {**body, "title": "نباید اعمال شود"}), 201
    ).json()
    assert (
        retried["id"] == first["id"]
        and retried["completed"]
        and retried["revision"] == done["revision"]
    )
    assert retried["title"] == first["title"] and len(tasks_of(client, home_a)) == 1
    assert expect_status(detail(client, home_a, pet), 200).json()["care_tasks"] == [retried]


def test_concurrent_same_care_operation_creates_one_task(client, home_a):
    pet = create_pet(client, home_a)
    body = care_body(pet, assignee_id=home_a.member_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: care(client, home_a, pet, body), range(2)))
    assert [row.status_code for row in responses] == [201, 201]
    assert {row.json()["id"] for row in responses} == {body["operation_id"]}
    assert len(tasks_of(client, home_a)) == 1


def test_operation_collisions_other_pet_actor_regular_or_foreign_task_fail_safely(
    client, home_a, home_b
):
    first_pet = create_pet(client, home_a)
    second_pet = create_pet(client, home_a, name="دومی")
    body = care_body(first_pet)
    first = expect_status(care(client, home_a, first_pet, body), 201).json()
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    expect_status(care(client, admin, first_pet, body), 409)
    expect_status(care(client, home_a, second_pet, body), 409)
    regular = create_task(client, home_a)
    foreign = create_task(client, home_b)
    for task in (regular, foreign):
        expect_status(care(client, home_a, first_pet, {**body, "operation_id": task["id"]}), 409)
    assert [
        row["id"]
        for row in expect_status(detail(client, home_a, first_pet), 200).json()["care_tasks"]
    ] == [first["id"]]
    assert len(tasks_of(client, home_a)) == 2 and len(tasks_of(client, home_b)) == 1


def test_stale_or_invalid_care_write_rolls_back_and_valid_retry_can_create(client, home_a):
    pet = create_pet(client, home_a)
    body = care_body(pet)
    changed = expect_status(edit(client, home_a, pet, name="نام جدید"), 200).json()
    expect_status(care(client, home_a, pet, body), 409)
    invalid = {**body, "base_revision": changed["revision"], "assignee_id": str(uuid.uuid4())}
    expect_status(care(client, home_a, changed, invalid), 422)
    assert tasks_of(client, home_a) == []
    assert expect_status(detail(client, home_a, pet), 200).json()["pet"] == changed
    expect_status(
        care(client, home_a, changed, {**body, "base_revision": changed["revision"]}), 201
    )
    assert len(tasks_of(client, home_a)) == 1


def test_care_creation_rolls_back_when_canonical_task_creation_fails(client, home_a, monkeypatch):
    from app.core.errors import AppError
    from app.services import tasks

    pet = create_pet(client, home_a)
    body = care_body(pet)
    original = tasks.create_row

    def fail_after_insert(db, actor, task_body, entity_id=None):
        row = original(db, actor, task_body, entity_id)
        db.flush([row])
        raise AppError("SYNC_CONFLICT", "خطای هماهنگ‌سازی آزمایشی", 409)

    monkeypatch.setattr(tasks, "create_row", fail_after_insert)
    expect_status(care(client, home_a, pet, body), 409)
    assert tasks_of(client, home_a) == []
    assert expect_status(detail(client, home_a, pet), 200).json()["pet"] == pet
    monkeypatch.setattr(tasks, "create_row", original)
    expect_status(care(client, home_a, pet, body), 201)


def test_care_task_complete_permissions_and_demoted_creator_keep_task_permissions(client, home_a):
    assignee = add_active_member(client, home_a)
    other = add_active_member(client, home_a, "عضو دیگر")
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    pet = create_pet(client, admin)
    expect_status(care(client, admin, pet, assignee_id=assignee.member_id), 201)
    task = tasks_of(client, home_a)[0]
    assert expect_status(detail(client, assignee, pet), 200).json()["care_tasks"][0]["can_complete"]
    assert not expect_status(detail(client, other, pet), 200).json()["care_tasks"][0][
        "can_complete"
    ]
    expect_status(complete_task(client, other, task), 403)
    expect_status(edit_task(client, assignee, task, title="غیرمجاز"), 403)
    task = expect_status(complete_task(client, assignee, task), 200).json()
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/demote", headers=home_a.h), 200)
    viewed = expect_status(detail(client, admin, pet), 200).json()
    assert not viewed["can_create_care"] and not viewed["pet"]["can_edit"]
    assert viewed["care_tasks"][0]["can_complete"]
    expect_status(edit(client, admin, pet), 403)
    expect_status(care(client, admin, pet), 403)
    expect_status(edit_task(client, admin, task, title="اصلاح سازندهٔ کار"), 200)


def test_online_and_offline_task_edits_preserve_hidden_pet_link(client, raw_sql, home_a):
    pet = create_pet(client, home_a)
    created = expect_status(care(client, home_a, pet, assignee_id=home_a.member_id), 201).json()
    task = tasks_of(client, home_a)[0]
    task = expect_status(edit_task(client, home_a, task, title="ویرایش آنلاین"), 200).json()
    assert raw_pet_id(raw_sql, home_a, task["id"]) == pet["id"]
    queued = mutation(
        "task.update",
        task["id"],
        task["revision"],
        title="ویرایش آفلاین",
        description=task["description"],
        assignee_id=task["assignee_id"],
        due_date=task["due_date"],
    )
    changed = send(client, home_a, queued)["snapshot"]["tasks"][0]
    assert (
        changed["title"] == "ویرایش آفلاین" and raw_pet_id(raw_sql, home_a, task["id"]) == pet["id"]
    )
    assert send(client, home_a, queued)["replayed"]
    assert "pet_id" not in changed and "pets" not in snapshot(client, home_a)
    current = expect_status(detail(client, home_a, pet), 200).json()["care_tasks"][0]
    assert current["id"] == created["id"] and current["revision"] == changed["revision"]
    for mutation_kind in ("task.create", "task.update"):
        body = mutation(
            mutation_kind,
            str(uuid.uuid4()) if mutation_kind.endswith("create") else task["id"],
            None if mutation_kind.endswith("create") else changed["revision"],
            title="عنوان",
            pet_id=pet["id"],
        )
        send(client, home_a, body, 422)
    expect_status(edit_task(client, home_a, changed, pet_id=None), 422)


def test_deleting_pet_preserves_task_bumps_revision_and_conflicts_with_old_queue(
    client, raw_sql, home_a
):
    pet = create_pet(client, home_a)
    expect_status(care(client, home_a, pet, assignee_id=home_a.member_id), 201)
    task = tasks_of(client, home_a)[0]
    queued = mutation("task.update", task["id"], task["revision"], title="ویرایش قدیمی")
    expect_status(remove(client, home_a, pet), 204)
    current = tasks_of(client, home_a)[0]
    assert current["id"] == task["id"] and current["revision"] == task["revision"] + 1
    assert raw_pet_id(raw_sql, home_a, task["id"]) is None
    send(client, home_a, queued, 409)
    expect_status(edit_task(client, home_a, current, title="کار مستقل"), 200)
    expect_status(care(client, home_a, pet), 404)


def test_task_delete_removes_care_and_deleted_operation_can_recreate_under_live_pet(client, home_a):
    pet = create_pet(client, home_a)
    body = care_body(pet)
    created = expect_status(care(client, home_a, pet, body), 201).json()
    expect_status(
        client.delete(
            f"{API}/tasks/{created['id']}",
            headers=home_a.h,
            params={"base_revision": created["revision"]},
        ),
        204,
    )
    assert expect_status(detail(client, home_a, pet), 200).json()["care_tasks"] == []
    recreated = expect_status(care(client, home_a, pet, body), 201).json()
    assert recreated["id"] == created["id"] and recreated["revision"] == 1


def test_pending_active_child_is_valid_care_assignee_without_new_identity(client, home_a):
    child = expect_status(
        client.post(f"{API}/children", headers=home_a.h, json={"name": "آراد", "birth_date": None}),
        201,
    ).json()
    pet = create_pet(client, home_a)
    created = expect_status(care(client, home_a, pet, assignee_id=child["id"]), 201).json()
    view = expect_status(client.get(f"{API}/children/{child['id']}", headers=home_a.h), 200).json()
    assert view["tasks"][0]["id"] == created["id"]
    assert view["birthday"] is None and view["activities"] == []


@pytest.mark.parametrize("state", ["pending", "suspended", "removed", "rejected", "expired"])
def test_inactive_care_assignee_rejected_and_inactive_actor_denied(client, raw_sql, home_a, state):
    member = add_active_member(client, home_a)
    pet = create_pet(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": member.member_id},
    )
    raw_sql.commit()
    expect_status(care(client, home_a, pet, assignee_id=member.member_id), 422)
    for response in (
        client.get(PETS, headers=member.h),
        detail(client, member, pet),
        edit(client, member, pet),
        remove(client, member, pet),
        care(client, member, pet),
    ):
        expect_status(response, 403)
    scope(raw_sql, home_a, member.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM pets")).scalar_one() == 0
    raw_sql.rollback()


@pytest.mark.parametrize(
    "fields",
    [
        {"name": " "},
        {"name": None},
        {"name": "x" * 81},
        {"species": " "},
        {"species": None},
        {"species": "x" * 61},
        {"breed": "x" * 101},
        {"birth_date": True},
        {"birth_date": 0},
        {"birth_date": "2026-02-30"},
        {"birth_date": "2026-11-15T12:00:00Z"},
        {"birth_date": "9999-12-31"},
        {"birth_date": "0001-01-01"},
        {"family_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"revision": 2},
        {"cost_amount": "1000"},
        {"document_id": str(uuid.uuid4())},
        {"photo": "test"},
        {"medical": "متن"},
    ],
)
def test_invalid_or_unapproved_pet_fields_do_not_persist(client, home_a, fields):
    expect_status(
        client.post(
            PETS,
            headers=home_a.h,
            json={"name": "حیوان", "species": "گربه", "birth_date": None, **fields},
        ),
        422,
    )
    assert listed(client, home_a)["pets"] == []


def test_profile_limits_and_optional_date_supported(client, home_a):
    pet = create_pet(
        client, home_a, name="x" * 80, species="x" * 60, breed="x" * 100, birth_date="2020-01-01"
    )
    assert len(pet["name"]) == 80 and len(pet["species"]) == 60 and len(pet["breed"]) == 100
    assert pet["birth_date"] == "2020-01-01"
    omitted = expect_status(
        client.post(PETS, headers=home_a.h, json={"name": "بدون تاریخ", "species": "گربه"}), 201
    ).json()
    assert omitted["birth_date"] is None and omitted["breed"] is None


@pytest.mark.parametrize("revision", [True, "1", 0, -1, 1.5, None])
def test_profile_and_care_revisions_are_strict_positive_integers(client, home_a, revision):
    pet = create_pet(client, home_a)
    expect_status(edit(client, home_a, pet, base_revision=revision), 422)
    expect_status(care(client, home_a, pet, base_revision=revision), 422)
    assert tasks_of(client, home_a) == []


@pytest.mark.parametrize(
    "fields",
    [
        {"operation_id": "invalid"},
        {"operation_id": None},
        {"title": " "},
        {"title": "x" * 121},
        {"description": "x" * 2001},
        {"due_date": "2026-02-30"},
        {"due_date": True},
        {"due_date": "2026-11-15T00:00:00Z"},
        {"pet_id": str(uuid.uuid4())},
        {"created_by": str(uuid.uuid4())},
        {"completed": True},
        {"completion_photo": "test"},
        {"reminder_enabled": True},
        {"cost_amount": "1000"},
    ],
)
def test_invalid_care_inputs_cannot_create_or_spoof_tasks(client, home_a, fields):
    pet = create_pet(client, home_a)
    expect_status(care(client, home_a, pet, **fields), 422)
    assert tasks_of(client, home_a) == []


def test_pet_cap_serializes_concurrent_creation(client, home_a, monkeypatch):
    from app.services import pets

    monkeypatch.setattr(pets, "_MAX_PETS", 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda name: client.post(
                    PETS,
                    headers=home_a.h,
                    json={"name": name, "species": "گربه", "birth_date": None},
                ),
                ["اول", "دوم"],
            )
        )
    assert sorted(row.status_code for row in responses) == [201, 409]
    assert len(listed(client, home_a)["pets"]) == 1


def test_concurrent_profile_updates_have_one_winner(client, home_a):
    pet = create_pet(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda name: edit(client, home_a, pet, name=name), ["اول", "دوم"])
        )
    assert sorted(row.status_code for row in responses) == [200, 409]


def test_database_pet_context_and_manager_policy_reject_unset_and_other_member(
    client, raw_sql, home_a
):
    other = add_active_member(client, home_a)
    pet = create_pet(client, home_a)
    for member_id, count in ((None, 0), (other.member_id, 1), (home_a.member_id, 1)):
        scope(raw_sql, home_a, member_id)
        assert raw_sql.execute(text("SELECT count(*) FROM pets")).scalar_one() == count
        raw_sql.rollback()
    scope(raw_sql, home_a, other.member_id)
    assert (
        raw_sql.execute(
            text("UPDATE pets SET name='denied' WHERE id=:id"), {"id": pet["id"]}
        ).rowcount
        == 0
    )
    assert raw_sql.execute(text("DELETE FROM pets WHERE id=:id"), {"id": pet["id"]}).rowcount == 0
    raw_sql.rollback()
    scope(raw_sql, home_a, other.member_id)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO pets (family_id,created_by,name,species) "
                "VALUES (:fid,:mid,'test','cat')"
            ),
            {"fid": home_a.family_id, "mid": other.member_id},
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()


@pytest.mark.parametrize(
    "assignment", ["created_by=NULL", "created_by=:other", "family_id=:foreign"]
)
def test_database_pet_creator_and_family_immutable(client, raw_sql, home_a, home_b, assignment):
    other = add_active_member(client, home_a)
    pet = create_pet(client, home_a)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(f"UPDATE pets SET {assignment} WHERE id=:id"),  # noqa: S608
            {"id": pet["id"], "other": other.member_id, "foreign": home_b.family_id},
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()


def test_task_pet_family_fk_and_task_family_scope_reject_foreign_links(
    client, raw_sql, home_a, home_b
):
    pet = create_pet(client, home_a)
    foreign = create_pet(client, home_b)
    task = create_task(client, home_a)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text("UPDATE tasks SET pet_id=:pid WHERE id=:id"),
            {"pid": foreign["id"], "id": task["id"]},
        )
    assert error.value.orig.diag.constraint_name == "fk_task_pet_family"
    raw_sql.rollback()
    expect_status(care(client, home_a, pet), 201)
    scope(raw_sql, home_a, home_a.member_id)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text("UPDATE tasks SET family_id=:fid WHERE pet_id=:pid"),
            {"fid": home_b.family_id, "pid": pet["id"]},
        )
    assert error.value.orig.sqlstate in {"42501", "23503"}
    raw_sql.rollback()


@pytest.mark.parametrize("member_context", ["unset", "manager"])
def test_database_unset_context_and_forged_pet_creator_cannot_insert(
    client, raw_sql, home_a, member_context
):
    other = add_active_member(client, home_a)
    scope(raw_sql, home_a, home_a.member_id if member_context == "manager" else None)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO pets (family_id,created_by,name,species) "
                "VALUES (:fid,:mid,'test','cat')"
            ),
            {"fid": home_a.family_id, "mid": other.member_id},
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()


def test_deleted_pet_creator_nulls_creator_and_keeps_pet_and_care(client, raw_sql, home_a):
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    pet = create_pet(client, admin)
    created = expect_status(care(client, admin, pet, assignee_id=home_a.member_id), 201).json()
    expect_status(client.delete(f"{AUTH}/members/{admin.member_id}", headers=home_a.h), 200)
    current = expect_status(detail(client, home_a, pet), 200).json()
    assert (
        current["pet"]["revision"] > pet["revision"]
        and current["care_tasks"][0]["id"] == created["id"]
    )
    scope(raw_sql, home_a, home_a.member_id)
    assert (
        raw_sql.execute(
            text("SELECT created_by FROM pets WHERE id=:id"), {"id": pet["id"]}
        ).scalar_one()
        is None
    )
    raw_sql.rollback()


def test_pet_birth_and_care_create_no_calendar_finance_or_private_side_effects(
    client, raw_sql, home_a
):
    baseline = expect_status(
        client.post(
            f"{API}/events", headers=home_a.h, json={"title": "مناسبت موجود", "date": "2026-11-15"}
        ),
        201,
    ).json()
    pet = create_pet(client, home_a, birth_date="2020-01-10")
    created = expect_status(
        care(client, home_a, pet, assignee_id=home_a.member_id, description="توضیح محفوظ"), 201
    ).json()
    scope(raw_sql, home_a, home_a.member_id)
    raw_sql.execute(
        text(
            "UPDATE tasks SET completed=true,completed_at=now(),"
            "completion_photo_url='urn:test:care-photo' WHERE id=:id"
        ),
        {"id": created["id"]},
    )
    raw_sql.commit()
    current = expect_status(detail(client, home_a, pet), 200).json()
    assert set(current["care_tasks"][0]) == _CARE_OUTPUT
    assert "توضیح محفوظ" not in str(current) and "care-photo" not in str(current)
    assert "pet_id" not in str(current) and "created_by" not in str(current)
    assert [
        row["id"]
        for row in expect_status(client.get(f"{API}/events", headers=home_a.h), 200).json()
    ] == [baseline["id"]]
    for path in ("transactions", "documents", "activities"):
        output = expect_status(client.get(f"{API}/{path}", headers=home_a.h), 200).json()
        assert output == ([] if path != "activities" else {"activities": [], "can_create": True})
    assert expect_status(client.get(f"{API}/goals", headers=home_a.h), 200).json()["goals"] == []
    members = expect_status(client.get(f"{AUTH}/members", headers=home_a.h), 200).json()
    assert len(members) == 1


def test_pet_success_and_errors_no_store_and_audit_omits_profile_and_care_text(
    client, home_a, caplog
):
    with caplog.at_level("INFO", logger="app.services.pets"):
        created = expect_status(
            client.post(
                PETS,
                headers=home_a.h,
                json={
                    "name": "نام محرمانه",
                    "species": "نوع محرمانه",
                    "breed": "نژاد محرمانه",
                    "birth_date": "2020-01-10",
                },
            ),
            201,
        )
        pet = created.json()
        created_care = expect_status(
            care(client, home_a, pet, title="عنوان محرمانه", description="توضیح محرمانه"), 201
        )
        changed = expect_status(edit(client, home_a, pet, name="نام محرمانهٔ جدید"), 200)
    for response in (
        created,
        created_care,
        changed,
        client.get(PETS, headers=home_a.h),
        detail(client, home_a, pet),
        client.get(PETS),
        client.get(f"{PETS}/{uuid.uuid4()}", headers=home_a.h),
        client.post(PETS, headers=home_a.h, json={"name": ""}),
        edit(client, home_a, pet),
    ):
        assert response.headers["Cache-Control"] == "no-store"
    records = [
        record.getMessage() for record in caplog.records if record.name == "app.services.pets"
    ]
    assert any(pet["id"] in row for row in records)
    assert all("محرمانه" not in row and "2020-01-10" not in row for row in records)


@pytest.mark.parametrize("revocation", ["role", "membership"])
def test_stale_manager_rls_denial_is_403_rolls_back_and_omits_profile_from_logs(
    client, raw_sql, home_a, monkeypatch, caplog, revocation
):
    from app.core.errors import AppError
    from app.services import pets

    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    original = pets.create

    def create_after_revocation(db, actor, body):
        assert actor.role == "admin" and actor.membership_state == "active"
        assignment = "role='member'" if revocation == "role" else "membership_state='suspended'"
        raw_sql.execute(
            text(f"UPDATE members SET {assignment} WHERE id=:id"),  # noqa: S608
            {"id": actor.id},
        )
        raw_sql.commit()
        try:
            return original(db, actor, body)
        except AppError:
            assert db.is_active and not db.in_transaction()
            raise

    monkeypatch.setattr(pets, "create", create_after_revocation)
    with caplog.at_level("INFO"):
        response = expect_status(
            client.post(
                PETS,
                headers=admin.h,
                json={
                    "name": "نام پروفایل محرمانه",
                    "species": "نوع پروفایل محرمانه",
                    "breed": "نژاد پروفایل محرمانه",
                    "birth_date": "2020-01-10",
                },
            ),
            403,
        )
    assert response.json()["error"] == "PET_FORBIDDEN"
    assert response.headers["Cache-Control"] == "no-store"
    assert listed(client, home_a)["pets"] == []
    assert all(
        "محرمانه" not in record.getMessage() and "2020-01-10" not in record.getMessage()
        for record in caplog.records
    )
