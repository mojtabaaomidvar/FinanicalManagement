"""SMS review is personal, including when another family member is an owner."""
import uuid

from sqlalchemy import text

from tests.conftest import API


def insert_sms(raw_sql, family_id, member_id=None, account_id=None):
    sms_id = str(uuid.uuid4())
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": family_id})
    raw_sql.execute(text("INSERT INTO sms_messages (id, family_id, member_id, account_id, raw_text) "
                         "VALUES (CAST(:id AS uuid), CAST(:family AS uuid), CAST(:member AS uuid), "
                         "CAST(:account AS uuid), 'ownership test')"),
                    {"id": sms_id, "family": family_id, "member": member_id, "account": account_id})
    raw_sql.commit()
    return sms_id


def account(client, actor):
    res = client.post(f"{API}/accounts", headers=actor.h,
                      json={"member_id": actor.member_id, "title": "own wallet", "kind": "wallet"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_each_member_can_only_read_and_change_own_messages(client, home_a, member_a, home_b, raw_sql):
    actors = [home_a, member_a, home_b]
    ids = [insert_sms(raw_sql, actor.family_id, actor.member_id) for actor in actors]
    for index, actor in enumerate(actors):
        assert [row["id"] for row in client.get(f"{API}/sms?status=pending", headers=actor.h).json()] == [ids[index]]
        for other, sms_id in enumerate(ids):
            res = client.patch(f"{API}/sms/{sms_id}", headers=actor.h, json={"status": "ignored"})
            assert res.status_code == (204 if other == index else 404), res.text


def test_legacy_sms_is_scoped_to_account_and_unassigned_owner(client, home_a, member_a, raw_sql):
    owner_acc, member_acc = account(client, home_a), account(client, member_a)
    own = insert_sms(raw_sql, home_a.family_id, account_id=owner_acc)
    members = insert_sms(raw_sql, home_a.family_id, account_id=member_acc)
    orphan = insert_sms(raw_sql, home_a.family_id)
    for actor, visible in [(home_a, {own, orphan}), (member_a, {members})]:
        assert {row["id"] for row in client.get(f"{API}/sms", headers=actor.h).json()} == visible
        for sms_id in {own, members, orphan}:
            res = client.patch(f"{API}/sms/{sms_id}", headers=actor.h, json={"status": "recorded"})
            assert res.status_code == (204 if sms_id in visible else 404), res.text


def test_explicit_recipient_wins_over_linked_account(client, home_a, member_a, raw_sql):
    sms_id = insert_sms(raw_sql, home_a.family_id, member_a.member_id, account(client, home_a))
    assert client.get(f"{API}/sms", headers=home_a.h).json() == []
    assert client.patch(f"{API}/sms/{sms_id}", headers=home_a.h, json={"status": "recorded"}).status_code == 404
    assert client.get(f"{API}/sms", headers=member_a.h).json()[0]["id"] == sms_id
