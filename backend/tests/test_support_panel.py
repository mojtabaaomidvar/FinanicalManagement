"""Real PostgreSQL boundaries: operator auth, minimal output and no financial access."""

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import AUTH, create_household

PREFIX = "/api/v1/support"
ORIGIN = {"Origin": "http://testserver"}
PASSWORD = "Support-Test-Only-9381"


@pytest.fixture(autouse=True)
def operator(monkeypatch):
    from app.core.config import settings
    from app.core.security import hash_password
    monkeypatch.setattr(settings, "support_username", "operator")
    monkeypatch.setattr(settings, "support_password_hash", hash_password(PASSWORD))
    monkeypatch.setattr(settings, "cors_origins", "http://testserver")
    monkeypatch.setattr(settings, "support_origins", "")
    monkeypatch.setattr(settings, "rl_support_login_per_ip", 20)


def login(client):
    response = client.post(PREFIX+"/login", headers=ORIGIN,
                           json={"username":"operator", "password":PASSWORD})
    assert response.status_code == 200, response.text
    assert response.json() == {"authenticated":True}
    return client.cookies.get("khaneyar_support")


def test_disabled_requires_explicit_credentials(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,"support_password_hash","")
    for path in ("/session","/users","/overview","/technical"):
        response = client.get(PREFIX+path)
        assert response.status_code == 503
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/users","/overview","/technical"])
def test_family_administrator_is_not_operator(client,path):
    owner = create_household(client)
    response = client.get(PREFIX+path,headers=owner.h)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert client.get(PREFIX+"/session",headers=owner.h).json() == {"authenticated":False}


def test_cookie_is_httponly_scoped_short_and_not_a_finance_token(client):
    create_household(client)
    raw = login(client)
    response = client.get(PREFIX+"/session")
    assert response.json() == {"authenticated":True}
    response = client.post(PREFIX+"/login",headers=ORIGIN,json={"username":"operator","password":PASSWORD})
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Max-Age=1800" in cookie
    assert "Path=/api/v1/support" in cookie and "SameSite=strict" in cookie
    for path in ("/accounts","/transactions","/documents","/sms","/auth/session"):
        response = client.get("/api/v1"+path,headers={"Authorization":"Bearer "+raw})
        assert response.status_code == 401
    response = client.post("/api/v1/transactions",headers={"Authorization":"Bearer "+raw},
                           json={"type":"income","amount":999})
    assert response.status_code == 401


def test_production_cookie_requires_https(client,monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,"app_env","production")
    response = client.post(PREFIX+"/login",headers=ORIGIN,json={"username":"operator","password":PASSWORD})
    assert response.status_code == 200 and "; Secure" in response.headers["set-cookie"]


@pytest.mark.parametrize("origin", [None,"https://untrusted.example"])
def test_login_and_logout_reject_untrusted_origin(client,origin):
    login(client)
    headers = {"Origin":origin} if origin else {}
    response = client.post(PREFIX+"/login",headers=headers,json={"username":"operator","password":PASSWORD})
    assert response.status_code == 403
    assert client.post(PREFIX+"/logout",headers=headers).status_code == 403
    assert client.get(PREFIX+"/session").json()["authenticated"]


def test_logout_revokes_replayed_cookie(client):
    raw = login(client)
    response = client.post(PREFIX+"/logout",headers=ORIGIN)
    assert response.status_code == 204 and response.headers["cache-control"] == "no-store"
    assert client.get(PREFIX+"/users",headers={"Cookie":"khaneyar_support="+raw}).status_code == 401


def test_expiry_and_credential_rotation_revoke_sessions(client,raw_sql,monkeypatch):
    from app.core.config import settings
    login(client)
    raw_sql.execute(text("UPDATE support_sessions SET expires_at=:expired"),
                    {"expired":datetime.now(timezone.utc)-timedelta(seconds=1)})
    raw_sql.commit()
    assert client.get(PREFIX+"/users").status_code == 401
    login(client)
    monkeypatch.setattr(settings,"support_username","changed-operator")
    assert client.get(PREFIX+"/session").json() == {"authenticated":False}
    assert client.get(PREFIX+"/users").status_code == 401


def test_bad_login_and_validation_never_echo_input(client):
    responses = [client.post(PREFIX+"/login",headers=ORIGIN,json={"username":user,"password":password})
                 for user,password in (("operator","private-password-marker"),("private-username-marker",PASSWORD))]
    assert all(response.status_code == 401 for response in responses)
    assert responses[0].json() == responses[1].json()
    response = client.post(PREFIX+"/login",headers=ORIGIN,json={"username":"operator","password":"private-marker"*20})
    assert response.status_code == 422
    assert "private-marker" not in response.text and "input" not in response.json()


def test_persistent_login_throttle(client,monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,"rl_support_login_per_ip",2)
    for expected in (401,401,429):
        response = client.post(PREFIX+"/login",headers=ORIGIN,json={"username":"operator","password":"bad-password"})
        assert response.status_code == expected


def test_roster_has_only_independent_code_and_signup_metadata(client):
    owner = create_household(client,name="PRIVATE_FAMILY",owner="PRIVATE_NAME")
    own = client.get("/api/v1/members/me/support-code",headers=owner.h)
    assert own.status_code == 200
    code = own.json()["support_code"]
    assert UUID(code) != UUID(owner.member_id) and UUID(code) != UUID(owner.family_id)
    login(client)
    roster = client.get(PREFIX+"/users").json()
    assert roster["total"] == 1
    assert set(roster["items"][0]) == {"support_code","created_at","registration_state","membership_state","registered_at","last_login_at","stage","attention_reason"}
    assert roster["items"][0]["support_code"] == code
    assert roster["items"][0]["registration_state"] == "registered"
    for private in ("PRIVATE_NAME","PRIVATE_FAMILY",owner.phone,owner.member_id,owner.family_id):
        assert private not in json.dumps(roster)
    assert client.get(PREFIX+"/users",params={"code":code}).json()["total"] == 1
    for invalid in (owner.phone,"PRIVATE_NAME",owner.member_id):
        assert client.get(PREFIX+"/users",params={"code":invalid}).json()["items"] == []
    assert client.get("/api/v1/members/"+owner.member_id+"/support-code",headers=owner.h).status_code == 404


def test_filters_pagination_and_incomplete_registration_are_distinct(client,raw_sql):
    one = create_household(client)
    two = create_household(client)
    raw_sql.execute(text("UPDATE members SET membership_state='pending' WHERE id=:id"),{"id":two.member_id})
    raw_sql.execute(text("INSERT INTO members(family_id,name,status) VALUES(:id,'PRIVATE_CHILD','pending')"),{"id":one.family_id})
    raw_sql.execute(text("INSERT INTO members(family_id,name) VALUES(:id,'PRIVATE_MANAGED')"),{"id":one.family_id})
    raw_sql.commit()
    login(client)
    overview = client.get(PREFIX+"/overview")
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert (data["registered"],data["introduced"],data["managed"],data["awaiting_approval"],data["active"]) == (2,1,1,1,1)
    assert len(data["daily"]) == 7 and data["new_registrations"] == 2
    for state in ("registered","introduced","managed"):
        response = client.get(PREFIX+"/users",params={"registration":state})
        assert all(row["registration_state"]==state for row in response.json()["items"])
    assert client.get(PREFIX+"/users",params={"membership":"pending"}).json()["total"] == 1
    first = client.get(PREFIX+"/users",params={"limit":2}).json()
    second = client.get(PREFIX+"/users",params={"limit":2,"offset":2}).json()
    assert first["total"] == second["total"] == 4
    assert len({item["support_code"] for item in first["items"]+second["items"]}) == 4


@pytest.mark.parametrize("days,expected", [(7,200),(30,200),(8,422),(0,422)])
def test_overview_query_period(client,days,expected):
    login(client)
    response = client.get(PREFIX+"/overview",params={"days":days})
    assert response.status_code == expected
    if expected == 200:
        assert len(response.json()["daily"]) == days


@pytest.mark.parametrize("parameters", [{"limit":51},{"offset":-1},{"code":"X"*65},{"membership":"private-marker"}])
def test_roster_validation(client,parameters):
    login(client)
    response = client.get(PREFIX+"/users",params=parameters)
    assert response.status_code == 422 and "private-marker" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_data_dependency_enforces_postgres_read_only(client):
    from app.api.v1.routes.support import read_only_db
    generator = read_only_db(_operator=None)
    db = next(generator)
    try:
        assert db.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE members SET name='changed'"))
    finally:
        generator.close()


def test_errors_are_aggregate_only_and_no_history_is_invented(client,raw_sql):
    login(client)
    initial = client.get(PREFIX+"/technical").json()
    assert initial["login_errors"] == initial["registration_errors"] == initial["server_errors"] == 0
    response = client.post(AUTH+"/login",json={"phone":"09120000000","password":"PRIVATE_LOGIN_PASSWORD"})
    assert response.status_code >= 400
    response = client.post(AUTH+"/register",json={"phone":"PRIVATE_PHONE","password":"PRIVATE_REGISTRATION_PASSWORD"})
    assert response.status_code == 422
    technical = client.get(PREFIX+"/technical").json()
    assert technical["login_errors"] == 1 and technical["registration_errors"] == 1
    assert technical["api"] == technical["database"] == "available"
    columns = raw_sql.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='support_error_counters'"))
    assert {row[0] for row in columns} == {"hour","kind","http_family","count"}
    assert "PRIVATE_" not in json.dumps(technical)


def test_counter_failure_does_not_change_auth_result(client,monkeypatch):
    from app.services import support
    def unavailable():
        raise RuntimeError("PRIVATE_DATABASE_DETAIL")
    monkeypatch.setattr(support,"SessionLocal",unavailable)
    response = client.post(AUTH+"/register",json={})
    assert response.status_code == 422 and "PRIVATE_DATABASE_DETAIL" not in response.text


def test_pending_join_receives_own_code_without_a_member_session(client):
    from tests.conftest import next_phone, PASSWORD
    owner = create_household(client)
    response = client.post(AUTH + "/join", json={"code": owner.family_code,
        "member_name": "PRIVATE_JOIN_NAME", "phone": next_phone(), "password": PASSWORD, "relation": "سایر"})
    assert response.status_code == 200
    pending = response.json()
    code = pending["support_code"]
    assert str(UUID(code)) == code and pending["state"] == "pending"
    assert "session_token" not in pending and "member_id" not in pending
    login(client)
    user = client.get(PREFIX + "/users", params={"code": code}).json()["items"][0]
    assert user["registration_state"] == "registered" and user["membership_state"] == "pending"
    assert set(user) == {"support_code", "created_at", "registration_state", "membership_state", "registered_at", "last_login_at", "stage", "attention_reason"}
