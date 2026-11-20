"""Aggregate-only usage and registration metadata under the actual database roles."""

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from tests.conftest import create_household, make_transaction, next_phone, PASSWORD, AUTH

PREFIX = "/api/v1/support"


@pytest.fixture(autouse=True)
def operator(monkeypatch):
    from app.core.config import settings
    from app.core.security import hash_password
    monkeypatch.setattr(settings, "support_username", "operator")
    monkeypatch.setattr(settings, "support_password_hash", hash_password("test-operator-password"))
    monkeypatch.setattr(settings, "support_origins", "http://testserver")


def login(client):
    response = client.post(PREFIX+"/login",headers={"Origin":"http://testserver"},
                           json={"username":"operator","password":"test-operator-password"})
    assert response.status_code == 200


def test_family_and_anonymous_sessions_cannot_read_usage(client):
    owner = create_household(client)
    assert client.get(PREFIX+"/usage").status_code == 401
    assert client.get(PREFIX+"/usage",headers=owner.h).status_code == 401


def test_counts_are_global_numbers_while_raw_family_rows_remain_under_rls(client, raw_sql):
    a, b = create_household(client,owner="PRIVATE_A"), create_household(client,owner="PRIVATE_B")
    make_transaction(client,a); make_transaction(client,b)
    for actor in (a,b):
        assert client.post("/api/v1/tasks",headers=actor.h,json={"title":"PRIVATE_TASK"}).status_code == 201
    assert raw_sql.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 0
    assert raw_sql.execute(text("SELECT count(*) FROM tasks")).scalar_one() == 0
    login(client)
    response = client.get(PREFIX+"/usage")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["records"]["transactions"] == 2 and data["records"]["open_tasks"] == 2
    assert set(data["records"]) == {"transactions","scheduled_plans","open_tasks","completed_tasks","shopping_lists","documents"}
    assert all(isinstance(value,int) for value in data["records"].values())
    for private in (a.member_id,b.member_id,a.family_id,b.family_id,a.phone,b.phone,"PRIVATE_"):
        assert private not in json.dumps(data)
    assert client.get(PREFIX+"/usage",params={"family_id":a.family_id}).json()["records"] == data["records"]
    assert raw_sql.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 0
    assert client.get(PREFIX+"/users/"+a.member_id+"/usage").status_code == 404


def test_count_function_is_read_only_fixed_scope_and_not_public(client,raw_sql):
    row = raw_sql.execute(text("SELECT p.pronargs,p.prosecdef,p.proconfig,r.rolsuper OR r.rolbypassrls AS privileged "
        "FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.proname='support_record_counts'" )).one()
    assert row.pronargs == 0 and row.prosecdef and row.privileged
    assert "search_path=pg_catalog" in row.proconfig and "row_security=off" in row.proconfig
    public = raw_sql.execute(text("SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a "
        "WHERE p.proname='support_record_counts' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).scalar_one()
    assert public == 0
    login(client)
    assert client.get(PREFIX+"/usage").json()["records"]["transactions"] == 0


def test_navigation_accepts_only_authenticated_fixed_module_names(client,raw_sql):
    owner = create_household(client)
    assert client.post("/api/v1/usage/open",json={"module":"tasks"}).status_code == 401
    response = client.post("/api/v1/usage/open",headers=owner.h,json={"module":"tasks","member_id":"PRIVATE_MARKER"})
    assert response.status_code == 422 and "PRIVATE_MARKER" not in response.text
    assert client.post("/api/v1/usage/open",headers=owner.h,json={"module":"PRIVATE_MODULE"}).status_code == 422
    assert client.post("/api/v1/usage/open",headers=owner.h,json={"module":"tasks"}).status_code == 204
    columns = raw_sql.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='support_usage_counters'"))
    assert {row[0] for row in columns} == {"hour","module","action","count"}
    login(client)
    data = client.get(PREFIX+"/usage").json()
    task = next(row for row in data["modules"] if row["module"]=="tasks")
    assert task["opens"] == 1
    assert owner.member_id not in json.dumps(data) and owner.phone not in json.dumps(data)


def test_usage_days_align_to_tehran_midnight(client,monkeypatch):
    from app.services import usage
    fixed = datetime(2026,11,19,20,45,tzinfo=timezone.utc)
    monkeypatch.setattr(usage,"utcnow",lambda: fixed)
    owner=create_household(client)
    client.post("/api/v1/usage/open",headers=owner.h,json={"module":"shopping"})
    login(client)
    data=client.get(PREFIX+"/usage").json()
    assert data["daily"][-1] == {"day":"2026-11-20","opens":1,"operations":0}


def test_failed_financial_requests_do_not_count_and_counter_failure_does_not_break_writes(client,monkeypatch):
    from app.services import usage
    owner=create_household(client)
    assert client.post("/api/v1/transactions",headers=owner.h,json={}).status_code == 422
    login(client)
    data=client.get(PREFIX+"/usage").json()
    assert next(row for row in data["modules"] if row["module"]=="transactions")["creates"] == 0
    def unavailable():
        raise RuntimeError("PRIVATE_COUNTER_ERROR")
    monkeypatch.setattr(usage,"SessionLocal",unavailable)
    tx=make_transaction(client,owner)
    assert tx
    response=client.get("/api/v1/transactions",headers=owner.h)
    assert response.status_code == 200 and len(response.json()) == 1


def test_registration_and_last_login_times_are_success_only_not_session_refresh(client,raw_sql):
    owner=create_household(client)
    times=raw_sql.execute(text("SELECT support_registered_at,support_last_login_at FROM members WHERE id=:id"),{"id":owner.member_id}).one()
    assert times[0] and times[1] and times[0] <= times[1]
    assert client.post(AUTH+"/login",json={"phone":owner.phone,"password":"wrong-password"}).status_code == 401
    assert client.get(AUTH+"/session",headers=owner.h).status_code == 200
    assert raw_sql.execute(text("SELECT support_last_login_at FROM members WHERE id=:id"),{"id":owner.member_id}).scalar_one() == times[1]
    raw_sql.execute(text("UPDATE members SET support_registered_at=NULL,support_last_login_at=NULL WHERE id=:id"),{"id":owner.member_id})
    raw_sql.commit()
    login(client)
    user=client.get(PREFIX+"/users").json()["items"][0]
    assert user["registered_at"] is None and user["last_login_at"] is None
    assert user["stage"]=="ready" and user["attention_reason"] is None


def test_pending_join_has_known_registration_time_without_a_fake_login(client):
    owner=create_household(client)
    pending=client.post(AUTH+"/join",json={"code":owner.family_code,"member_name":"PRIVATE_JOIN","phone":next_phone(),"password":PASSWORD,"relation":"سایر"}).json()
    login(client)
    user=client.get(PREFIX+"/users",params={"code":pending["support_code"]}).json()["items"][0]
    assert user["registered_at"] and user["last_login_at"] is None
    assert user["stage"]=="approval_pending" and user["attention_reason"]=="waiting_approval"


def test_new_support_origin_is_separate_from_household_origin(client,monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,"support_origins","https://supp.khaanehyar.ir")
    assert client.post(PREFIX+"/login",headers={"Origin":"http://testserver"},json={"username":"operator","password":"test-operator-password"}).status_code==403
    assert client.post(PREFIX+"/login",headers={"Origin":"https://supp.khaanehyar.ir"},json={"username":"operator","password":"test-operator-password"}).status_code==200
    assert client.get(PREFIX+"/usage",headers={"Origin":"https://pwa.khaanehyar.ir"}).status_code==403
    assert client.get(PREFIX+"/usage",headers={"Origin":"https://supp.khaanehyar.ir"}).status_code==200
