"""Account isolation and concurrent writes for the real personal Home arrangement."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest
from sqlalchemy import text

from tests.conftest import API, AUTH, Actor

HOME = f"{API}/members/me/home-preferences"
GROUPS = {
    "money": ["finance", "transactions", "accounts", "budgets", "bills", "market", "reports"],
    "daily": ["chores", "shopping", "inventory", "meals"],
    "belongings": ["equipment", "vehicles", "docs"],
    "family": ["calendar", "activities", "children", "pets", "goals"],
}


def arrangement(pins: list[str] | None = None) -> dict:
    return {
        "version": 1,
        "layout": "grouped",
        "pins": pins or [],
        "openGroups": ["daily"],
        "groupOrder": list(GROUPS),
        "groupModules": deepcopy(GROUPS),
        "flatOrder": [module for group in GROUPS.values() for module in group],
    }


def save(client, actor: Actor, prefs: dict, revision: int = 0):
    return client.patch(HOME, headers=actor.h, json={"revision": revision, "preferences": prefs})


def test_new_member_has_no_preferences(client, home_a):
    res = client.get(HOME, headers=home_a.h)
    assert res.status_code == 200, res.text
    assert res.headers["Cache-Control"] == "no-store"
    assert res.json() == {"revision": 0, "preferences": None}


def test_own_arrangement_round_trip_does_not_change_profile(client, home_a, raw_sql):
    before = raw_sql.execute(
        text("SELECT name, birth_date, theme, currency, profile_revision, notif_prefs "
             "FROM members WHERE id = CAST(:id AS uuid)"),
        {"id": home_a.member_id},
    ).one()
    prefs = arrangement(["calendar", "chores"])
    # Full transfer is valid: intentional empty groups survive saving.
    prefs["groupModules"]["daily"] += prefs["groupModules"]["money"]
    prefs["groupModules"]["money"] = []
    prefs["groupOrder"].reverse()
    res = save(client, home_a, prefs)
    assert res.status_code == 200, res.text
    assert res.json() == {"revision": 1, "preferences": prefs}
    assert client.get(HOME, headers=home_a.h).json() == res.json()
    raw_sql.commit()
    after = raw_sql.execute(
        text("SELECT name, birth_date, theme, currency, profile_revision, notif_prefs "
             "FROM members WHERE id = CAST(:id AS uuid)"),
        {"id": home_a.member_id},
    ).one()
    assert after == before


def test_preferences_are_personal_even_inside_same_family(client, home_a, member_a, home_b):
    owner_prefs = arrangement(["bills"])
    member_prefs = arrangement(["goals"])
    assert save(client, home_a, owner_prefs).status_code == 200
    assert save(client, member_a, member_prefs).status_code == 200
    assert client.get(HOME, headers=home_a.h).json()["preferences"] == owner_prefs
    assert client.get(HOME, headers=member_a.h).json()["preferences"] == member_prefs
    assert client.get(HOME, headers=home_b.h).json() == {"revision": 0, "preferences": None}
    # Preferences are neither profile fields nor included in shared family/auth payloads.
    for actor in (home_a, member_a):
        session = client.get(f"{AUTH}/session", headers=actor.h).json()
        for member in [session["member"], *session["members"]]:
            assert "home_preferences" not in member
            assert "home_preferences_revision" not in member
        rows = client.get(f"{AUTH}/members", headers=actor.h).json()
        assert all("home_preferences" not in row for row in rows)


def test_stale_write_is_rejected_without_replacing_saved_arrangement(client, home_a):
    prefs = arrangement(["shopping"])
    assert save(client, home_a, prefs).status_code == 200
    stale = save(client, home_a, arrangement(["finance"]))
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"] == "SYNC_CONFLICT"
    assert client.get(HOME, headers=home_a.h).json() == {"revision": 1, "preferences": prefs}
    changed = arrangement(["finance"])
    assert save(client, home_a, changed, revision=1).json() == {
        "revision": 2, "preferences": changed,
    }


def test_simultaneous_devices_accept_only_one_base_revision(client, home_a):
    gate = Barrier(2)

    def attempt(module_id: str):
        gate.wait(timeout=10)
        return save(client, home_a, arrangement([module_id]))

    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(attempt, ["shopping", "calendar"]))
    assert sorted(reply.status_code for reply in replies) == [200, 409]
    winner = next(reply for reply in replies if reply.status_code == 200)
    assert client.get(HOME, headers=home_a.h).json() == winner.json()


@pytest.mark.parametrize("method", ["GET", "PATCH"])
def test_requires_authentication(client, method):
    body = {"revision": 0, "preferences": arrangement()} if method == "PATCH" else None
    assert client.request(method, HOME, json=body).status_code == 401


@pytest.mark.parametrize("method", ["GET", "PATCH"])
def test_suspended_member_cannot_access_preferences(client, home_a, raw_sql, method):
    raw_sql.execute(
        text("UPDATE members SET membership_state='suspended' WHERE id=CAST(:id AS uuid)"),
        {"id": home_a.member_id},
    )
    raw_sql.commit()
    body = {"revision": 0, "preferences": arrangement()} if method == "PATCH" else None
    res = client.request(method, HOME, headers=home_a.h, json=body)
    assert res.status_code == 403, res.text


@pytest.mark.parametrize(
    "invalid",
    [
        "duplicate-pin", "unknown-pin", "duplicate-open", "duplicate-group", "missing-group",
        "unknown-group", "duplicate-flat", "missing-flat", "duplicate-catalog", "missing-module",
        "unknown-module", "unknown-field", "wrong-version", "bool-version", "invalid-layout",
    ],
)
def test_invalid_arrangement_is_rejected_without_writing(client, home_a, invalid):
    prefs = arrangement()
    if invalid == "duplicate-pin":
        prefs["pins"] = ["chores", "chores"]
    elif invalid == "unknown-pin":
        prefs["pins"] = ["settings"]
    elif invalid == "duplicate-open":
        prefs["openGroups"] = ["money", "money"]
    elif invalid == "duplicate-group":
        prefs["groupOrder"][0] = "daily"
    elif invalid == "missing-group":
        del prefs["groupModules"]["daily"]
    elif invalid == "unknown-group":
        prefs["groupModules"]["other"] = []
    elif invalid == "duplicate-flat":
        prefs["flatOrder"][0] = prefs["flatOrder"][1]
    elif invalid == "missing-flat":
        prefs["flatOrder"].pop()
    elif invalid == "duplicate-catalog":
        prefs["groupModules"]["daily"].append("finance")
    elif invalid == "missing-module":
        prefs["groupModules"]["daily"].remove("meals")
    elif invalid == "unknown-module":
        prefs["groupModules"]["daily"][0] = "settings"
    elif invalid == "unknown-field":
        prefs["family_id"] = home_a.family_id
    elif invalid == "wrong-version":
        prefs["version"] = 2
    elif invalid == "bool-version":
        prefs["version"] = True
    elif invalid == "invalid-layout":
        prefs["layout"] = "other"
    res = save(client, home_a, prefs)
    assert res.status_code == 422, res.text
    assert client.get(HOME, headers=home_a.h).json() == {"revision": 0, "preferences": None}


@pytest.mark.parametrize("revision", [-1, True, "0", 2_147_483_647])
def test_invalid_revision_rejected(client, home_a, revision):
    res = save(client, home_a, arrangement(), revision)
    assert res.status_code == 422, res.text


def test_cannot_choose_another_member_in_request_body(client, home_a, member_a):
    res = client.patch(
        HOME, headers=home_a.h,
        json={"revision": 0, "preferences": arrangement(), "member_id": member_a.member_id},
    )
    assert res.status_code == 422, res.text
    assert client.get(HOME, headers=member_a.h).json() == {"revision": 0, "preferences": None}
