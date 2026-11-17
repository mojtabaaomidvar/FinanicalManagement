"""Private goals/wishes: real HTTP, owner RLS, encryption and optimistic concurrency."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.config import settings
from tests.conftest import API, AUTH, add_active_member, expect_status

GOALS = f"{API}/goals"
_INPUT_FIELDS = ("kind", "title", "note", "target_date", "status", "reminder_enabled")


def create_goal(client, actor, **fields):
    return expect_status(
        client.post(GOALS, headers=actor.h, json={"title": "یادگیری زبان", **fields}), 201
    ).json()


def listed(client, actor):
    return expect_status(client.get(GOALS, headers=actor.h), 200).json()


def get_goal(client, actor, item):
    return client.get(f"{GOALS}/{item['id']}", headers=actor.h)


def edit(client, actor, item, **fields):
    return client.patch(
        f"{GOALS}/{item['id']}",
        headers=actor.h,
        json={
            **{key: item[key] for key in _INPUT_FIELDS},
            "base_revision": item["revision"],
            **fields,
        },
    )


def remove(client, actor, item):
    return client.delete(
        f"{GOALS}/{item['id']}", headers=actor.h, params={"base_revision": item["revision"]}
    )


def scope(conn, actor=None, member_id=None):
    conn.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": actor.family_id if actor else "", "mid": member_id or ""},
    )


def stored_content(conn, actor, item):
    scope(conn, actor, actor.member_id)
    payload = bytes(
        conn.execute(
            text("SELECT encrypted_content FROM goals WHERE id=:id"), {"id": item["id"]}
        ).scalar_one()
    )
    conn.rollback()
    return payload


def replace_content(conn, actor, item, payload):
    scope(conn, actor, actor.member_id)
    conn.execute(
        text("UPDATE goals SET encrypted_content=:data WHERE id=:id"),
        {"data": payload, "id": item["id"]},
    )
    conn.commit()


def test_goal_crud_normalization_defaults_and_wish_conversion_keep_one_record(client, home_a):
    item = create_goal(
        client,
        home_a,
        title="  یادگیری   زبان ",
        note="  خط اول\nخط دوم  ",
        target_date="2026-01-01",
    )
    assert item["title"] == "یادگیری زبان" and item["note"] == "خط اول\nخط دوم"
    assert item["owner_id"] == home_a.member_id and item["kind"] == "goal"
    assert item["status"] == "active" and item["reminder_enabled"] and item["revision"] == 1
    assert "family_id" not in item and "encrypted_content" not in item
    assert listed(client, home_a) == {"goals": [item], "can_create": True}
    assert expect_status(get_goal(client, home_a, item), 200).json() == item
    changed = expect_status(
        edit(
            client,
            home_a,
            item,
            kind="wish",
            status="done",
            reminder_enabled=False,
            target_date=None,
        ),
        200,
    ).json()
    assert changed["id"] == item["id"] and changed["kind"] == "wish" and changed["status"] == "done"
    assert changed["revision"] == 2 and changed["target_date"] is None
    reopened = expect_status(
        edit(client, home_a, changed, kind="goal", status="active"), 200
    ).json()
    assert reopened["id"] == item["id"] and reopened["revision"] == 3
    assert len(listed(client, home_a)["goals"]) == 1
    expect_status(remove(client, home_a, reopened), 204)
    assert listed(client, home_a)["goals"] == []


def test_optional_note_blank_normalizes_and_text_limits_are_supported(client, home_a):
    item = create_goal(client, home_a, title="الف" * 40, note="ب" * 2000, kind="wish")
    assert len(item["title"]) == 120 and len(item["note"]) == 2000
    item = expect_status(edit(client, home_a, item, note=" \n "), 200).json()
    assert item["note"] is None


def test_active_children_own_goals_independently_of_document_age_restriction(client, home_a):
    child = add_active_member(client, home_a)
    item = create_goal(client, child, kind="wish", title="دوچرخه")
    assert item["owner_id"] == child.member_id and listed(client, child)["can_create"]
    assert expect_status(get_goal(client, child, item), 200).json() == item
    expect_status(client.get(f"{API}/documents", headers=child.h), 403)
    item = expect_status(edit(client, child, item, status="done"), 200).json()
    expect_status(remove(client, child, item), 204)


def test_same_family_owner_admin_and_children_cannot_access_each_others_private_records(
    client, home_a
):
    first = add_active_member(client, home_a, "عضو اول")
    second = add_active_member(client, home_a, "عضو دوم")
    admin = add_active_member(client, home_a, "مدیر دوم")
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    item = create_goal(client, first)
    for actor in (home_a, second, admin):
        assert listed(client, actor)["goals"] == []
        expect_status(get_goal(client, actor, item), 404)
        expect_status(edit(client, actor, item, title="غیرمجاز"), 404)
        expect_status(remove(client, actor, item), 404)
    other = create_goal(client, home_a, title="خصوصی مدیر")
    expect_status(get_goal(client, first, other), 404)
    assert listed(client, first)["goals"] == [item]


def test_foreign_family_ids_are_not_readable_or_mutable(client, home_a, home_b):
    item = create_goal(client, home_a)
    assert listed(client, home_b)["goals"] == []
    expect_status(get_goal(client, home_b, item), 404)
    expect_status(edit(client, home_b, item), 404)
    expect_status(remove(client, home_b, item), 404)


def test_stale_edits_and_deletes_preserve_current_content_and_noop_advances_revision(
    client, raw_sql, home_a
):
    item = create_goal(client, home_a)
    previous_payload = stored_content(raw_sql, home_a, item)
    noop = expect_status(edit(client, home_a, item), 200).json()
    assert noop["revision"] == 2 and noop["title"] == item["title"]
    assert stored_content(raw_sql, home_a, item) != previous_payload
    expect_status(edit(client, home_a, item, title="قدیمی"), 409)
    expect_status(remove(client, home_a, item), 409)
    assert expect_status(get_goal(client, home_a, item), 200).json() == noop


def test_concurrent_edits_from_same_revision_have_one_winner(client, home_a):
    item = create_goal(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda title: edit(client, home_a, item, title=title), ["اول", "دوم"])
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert expect_status(get_goal(client, home_a, item), 200).json() == winner
    assert len(listed(client, home_a)["goals"]) == 1


def test_owner_cap_is_serialized_and_independent_of_other_members(client, home_a, monkeypatch):
    from app.services import goals

    monkeypatch.setattr(goals, "_MAX_GOALS", 1)
    child = add_active_member(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda title: client.post(GOALS, headers=home_a.h, json={"title": title}),
                ["اول", "دوم"],
            )
        )
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert len(listed(client, home_a)["goals"]) == 1
    child_item = create_goal(client, child)
    assert listed(client, child)["goals"] == [child_item]


@pytest.mark.parametrize(
    "fields",
    [
        {"title": " "},
        {"title": "x" * 121},
        {"title": None},
        {"note": "x" * 2001},
        {"kind": "shared"},
        {"kind": None},
        {"status": "archived"},
        {"status": True},
        {"reminder_enabled": 1},
        {"reminder_enabled": None},
        {"target_date": True},
        {"target_date": "2026-02-30"},
        {"target_date": "2026-11-15T00:00:00Z"},
        {"target_date": "20261115"},
        {"owner_id": str(uuid.uuid4())},
        {"family_id": str(uuid.uuid4())},
        {"encrypted_content": "fake"},
        {"amount": "1000"},
        {"document_id": str(uuid.uuid4())},
        {"visibility": "shared"},
    ],
)
def test_invalid_or_out_of_scope_creation_inputs_are_rejected_without_rows(client, home_a, fields):
    expect_status(client.post(GOALS, headers=home_a.h, json={"title": "هدف", **fields}), 422)
    assert listed(client, home_a)["goals"] == []


@pytest.mark.parametrize(
    "fields",
    [
        {"base_revision": True},
        {"base_revision": "1"},
        {"base_revision": 0},
        {"base_revision": 1.5},
        {"owner_id": str(uuid.uuid4())},
        {"family_id": str(uuid.uuid4())},
        {"status": "unknown"},
        {"kind": "unknown"},
        {"reminder_enabled": "true"},
    ],
)
def test_invalid_edits_do_not_modify_current_record(client, home_a, fields):
    item = create_goal(client, home_a)
    expect_status(edit(client, home_a, item, **fields), 422)
    assert expect_status(get_goal(client, home_a, item), 200).json() == item


@pytest.mark.parametrize("state", ["suspended", "removed", "pending", "rejected"])
def test_membership_revocation_blocks_saved_goal_ids_and_creates(client, raw_sql, home_a, state):
    child = add_active_member(client, home_a)
    item = create_goal(client, child)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": child.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(GOALS, headers=child.h), 403)
    expect_status(get_goal(client, child, item), 403)
    expect_status(edit(client, child, item), 403)
    expect_status(remove(client, child, item), 403)
    expect_status(client.post(GOALS, headers=child.h, json={"title": "مورد جدید"}), 403)
    scope(raw_sql, child, child.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM goals")).scalar_one() == 0
    raw_sql.rollback()


def test_pending_status_with_active_membership_is_denied_in_app_and_database(
    client, raw_sql, home_a
):
    child = add_active_member(client, home_a)
    create_goal(client, child)
    raw_sql.execute(
        text("UPDATE members SET status='pending' WHERE id=:id"), {"id": child.member_id}
    )
    raw_sql.commit()
    expect_status(client.get(GOALS, headers=child.h), 403)
    scope(raw_sql, child, child.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM goals")).scalar_one() == 0
    raw_sql.rollback()


def test_database_rls_requires_matching_member_family_and_active_owner_even_for_admin(
    client, raw_sql, home_a, home_b
):
    child = add_active_member(client, home_a)
    mine = create_goal(client, home_a)
    theirs = create_goal(client, child)
    cases = [
        (None, None, []),
        (home_a, None, []),
        (home_a, home_a.member_id, [mine["id"]]),
        (home_a, child.member_id, [theirs["id"]]),
        (home_b, home_a.member_id, []),
    ]
    for actor, member_id, ids in cases:
        scope(raw_sql, actor, member_id)
        visible = [str(value) for value in raw_sql.execute(text("SELECT id FROM goals")).scalars()]
        assert visible == ids
        raw_sql.rollback()
    scope(raw_sql, home_a, home_a.member_id)
    assert (
        raw_sql.execute(
            text("UPDATE goals SET status='done' WHERE id=:id"), {"id": theirs["id"]}
        ).rowcount
        == 0
    )
    assert (
        raw_sql.execute(text("DELETE FROM goals WHERE id=:id"), {"id": theirs["id"]}).rowcount == 0
    )
    raw_sql.rollback()


@pytest.mark.parametrize("member_context", [True, False])
def test_database_rejects_forged_owner_and_inserts_without_member_context(
    client, raw_sql, home_a, member_context
):
    child = add_active_member(client, home_a)
    scope(raw_sql, home_a, home_a.member_id if member_context else None)
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(
                "INSERT INTO goals (family_id,owner_id,encrypted_content) VALUES (:fid,:oid,:data)"
            ),
            {
                "fid": home_a.family_id,
                "oid": child.member_id if member_context else home_a.member_id,
                "data": b"x" * 35,
            },
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()


@pytest.mark.parametrize("field", ["owner_id", "family_id"])
def test_database_ownership_is_immutable(client, raw_sql, home_a, home_b, field):
    child = add_active_member(client, home_a)
    item = create_goal(client, home_a)
    scope(raw_sql, home_a, home_a.member_id)
    value = child.member_id if field == "owner_id" else home_b.family_id
    with pytest.raises(DBAPIError) as error:
        raw_sql.execute(
            text(f"UPDATE goals SET {field}=:value WHERE id=:id"),  # noqa: S608
            {"value": value, "id": item["id"]},
        )
    assert error.value.orig.sqlstate == "42501"
    raw_sql.rollback()
    assert expect_status(get_goal(client, home_a, item), 200).json() == item


def test_database_owner_family_fk_prevents_moving_member_away_from_existing_private_goals(
    client, raw_sql, home_a, home_b
):
    child = add_active_member(client, home_a)
    item = create_goal(client, child)
    with pytest.raises(IntegrityError) as error:
        raw_sql.execute(
            text("UPDATE members SET family_id=:fid WHERE id=:id"),
            {"fid": home_b.family_id, "id": child.member_id},
        )
    assert error.value.orig.diag.constraint_name == "fk_goal_owner_family"
    raw_sql.rollback()
    assert expect_status(get_goal(client, child, item), 200).json() == item


def test_title_and_note_are_encrypted_at_rest_and_goal_logs_do_not_contain_content(
    client, raw_sql, home_a, caplog
):
    title, note = "عنوان محرمانه", "یادداشت شخصی محرمانه"
    with caplog.at_level("INFO", logger="app.services.goals"):
        item = create_goal(client, home_a, title=title, note=note)
        expect_status(get_goal(client, home_a, item), 200)
        listed(client, home_a)
    payload = stored_content(raw_sql, home_a, item)
    assert (
        payload.startswith(b"KYGOAL1")
        and title.encode() not in payload
        and note.encode() not in payload
    )
    columns = set(
        raw_sql.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='goals'"
            )
        ).scalars()
    )
    assert "encrypted_content" in columns and "title" not in columns and "note" not in columns
    raw_sql.rollback()
    records = [
        record.getMessage() for record in caplog.records if record.name == "app.services.goals"
    ]
    assert any(item["id"] in record for record in records)
    assert all(title not in record and note not in record for record in records)


@pytest.mark.parametrize("key", ["", "malformed!", "eA=="])
def test_missing_or_invalid_key_returns_generic_503_without_writing(
    client, raw_sql, home_a, monkeypatch, key
):
    item = create_goal(client, home_a)
    original_payload = stored_content(raw_sql, home_a, item)
    monkeypatch.setattr(settings, "document_encryption_key", key)
    for response in (
        client.get(GOALS, headers=home_a.h),
        get_goal(client, home_a, item),
        edit(client, home_a, item, title="تغییر"),
        client.post(GOALS, headers=home_a.h, json={"title": "هدف جدید"}),
    ):
        expect_status(response, 503)
        assert response.json()["error"] == "GOALS_NOT_CONFIGURED"
        assert response.json()["message"] == "اهداف و آرزوها اکنون در دسترس نیستند."
    assert stored_content(raw_sql, home_a, item) == original_payload


@pytest.mark.parametrize("corruption", ["tag", "prefix", "json", "shape", "unicode"])
def test_corrupted_or_invalid_content_fails_closed_without_echoing_private_data(
    client, raw_sql, home_a, corruption
):
    from app.models.goal import Goal
    from app.services import goals
    from app.services.encrypted_payload import encrypt_payload

    item = create_goal(client, home_a)
    payload = stored_content(raw_sql, home_a, item)
    if corruption == "tag":
        payload = payload[:-1] + bytes([payload[-1] ^ 1])
    elif corruption == "prefix":
        payload = b"WRONG!!" + payload[7:]
    else:
        invalid = {"json": b"{not-json", "shape": b"[]", "unicode": b"\xff"}[corruption]
        row = Goal(
            id=uuid.UUID(item["id"]),
            family_id=uuid.UUID(home_a.family_id),
            owner_id=uuid.UUID(home_a.member_id),
        )
        payload = encrypt_payload(goals._cipher(), invalid, prefix=b"KYGOAL1", aad=goals._aad(row))
    replace_content(raw_sql, home_a, item, payload)
    for response in (get_goal(client, home_a, item), client.get(GOALS, headers=home_a.h)):
        expect_status(response, 503)
        assert response.json() == {
            "error": "GOAL_UNAVAILABLE",
            "message": "اهداف و آرزوها اکنون در دسترس نیستند.",
        }


@pytest.mark.parametrize("different_owner", [False, True])
def test_ciphertext_cannot_be_swapped_between_goals_or_owners(
    client, raw_sql, home_a, different_owner
):
    first = create_goal(client, home_a)
    second_owner = add_active_member(client, home_a) if different_owner else home_a
    second = create_goal(client, second_owner, title="خصوصی دوم")
    replace_content(raw_sql, home_a, first, stored_content(raw_sql, second_owner, second))
    expect_status(get_goal(client, home_a, first), 503)
    assert expect_status(get_goal(client, second_owner, second), 200).json() == second


def test_member_removal_revokes_session_and_physically_cascades_private_records(
    client, raw_sql, home_a
):
    child = add_active_member(client, home_a)
    item = create_goal(client, child)
    expect_status(client.delete(f"{AUTH}/members/{child.member_id}", headers=home_a.h), 200)
    assert get_goal(client, child, item).status_code in {401, 403}
    # Restore only the same opaque identity in the test DB to distinguish physical deletion
    # from rows merely becoming invisible because their former owner no longer exists.
    raw_sql.execute(
        text("INSERT INTO members (id,family_id,name,relation) VALUES (:id,:fid,'test','فرزند')"),
        {"id": child.member_id, "fid": home_a.family_id},
    )
    raw_sql.commit()
    scope(raw_sql, home_a, child.member_id)
    assert (
        raw_sql.execute(
            text("SELECT count(*) FROM goals WHERE id=:id"), {"id": item["id"]}
        ).scalar_one()
        == 0
    )
    raw_sql.rollback()


def test_family_deletion_physically_cascades_goals(client, raw_sql, home_a):
    item = create_goal(client, home_a)
    raw_sql.execute(text("DELETE FROM families WHERE id=:fid"), {"fid": home_a.family_id})
    raw_sql.commit()
    raw_sql.execute(
        text("INSERT INTO families (id,name,code) VALUES (:fid,'test','GOAL-CASCADE-TEST')"),
        {"fid": home_a.family_id},
    )
    raw_sql.execute(
        text("INSERT INTO members (id,family_id,name) VALUES (:id,:fid,'test')"),
        {"id": home_a.member_id, "fid": home_a.family_id},
    )
    raw_sql.commit()
    scope(raw_sql, home_a, home_a.member_id)
    assert (
        raw_sql.execute(
            text("SELECT count(*) FROM goals WHERE id=:id"), {"id": item["id"]}
        ).scalar_one()
        == 0
    )
    raw_sql.rollback()


def test_success_and_error_routes_are_no_store_and_no_other_domain_data_is_created(client, home_a):
    created = expect_status(client.post(GOALS, headers=home_a.h, json={"title": "هدف جدید"}), 201)
    item = created.json()
    for response in (
        created,
        client.get(GOALS, headers=home_a.h),
        get_goal(client, home_a, item),
        edit(client, home_a, item),
        client.get(GOALS),
        client.post(GOALS, headers=home_a.h, json={"title": ""}),
        client.get(f"{GOALS}/{uuid.uuid4()}", headers=home_a.h),
    ):
        assert response.headers["Cache-Control"] == "no-store"
    for path in ("transactions", "tasks", "documents"):
        assert expect_status(client.get(f"{API}/{path}", headers=home_a.h), 200).json() == []
    snapshot = expect_status(client.get(f"{API}/shopping/offline", headers=home_a.h), 200).json()
    assert "goals" not in snapshot


def test_private_goals_do_not_create_notification_dismissal_records(client, raw_sql, home_a):
    item = create_goal(client, home_a, target_date="2026-11-15")
    expect_status(edit(client, home_a, item, status="done"), 200)
    scope(raw_sql, home_a, home_a.member_id)
    assert raw_sql.execute(text("SELECT count(*) FROM notification_dismissals")).scalar_one() == 0
    raw_sql.rollback()
