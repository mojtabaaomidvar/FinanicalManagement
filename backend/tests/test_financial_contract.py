"""Old financial clients fail before authorization/body parsing or ledger changes."""
import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.financial_contract import FinancialContractMiddleware

HEADER = "X-Khaneyar-Money-Contract"
CONTRACT = "decimal-v1"


@pytest.mark.parametrize("path,method", [
    ("/api/v1/accounts", "GET"), ("/api/v1/accounts/", "POST"),
    ("/api/v1/accounts/id", "PATCH"), ("/api/v1/accounts/id/corrections", "POST"),
    ("/api/v1/transactions/id/recurring", "PATCH"),
    ("/api/v1/transactions/id/settle", "POST"), ("/api/v1/bills/id/pay", "POST"),
    ("/api/v1/shopping/lists/id/complete", "POST"), ("/api/v1/shopping/items/id", "PATCH"),
    ("/api/v1/sms/id/record", "POST"), ("/api/v1/vehicles/id/services", "POST"),
    ("/api/v1/equipment/id/services/", "POST"), ("/api/v1/vehicles/id", "DELETE"),
    ("/api/v1/equipment/id", "DELETE"),
])
@pytest.mark.parametrize("contract", [None, "numeric-v0", "decimal-v1, numeric-v0"])
def test_gate_rejects_incompatible_calls_without_executing_handler(path, method, contract):
    calls = []

    async def handler(request):
        calls.append(await request.body())
        return JSONResponse({"unexpected": True})

    app = Starlette(routes=[Route(path.rstrip("/"), handler, methods=[method])])
    app.add_middleware(FinancialContractMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["https://pwa.khaanehyar.ir"],
                       allow_methods=[method], allow_headers=[HEADER])
    headers = {"Origin": "https://pwa.khaanehyar.ir"}
    if contract is not None:
        headers[HEADER] = contract
    with TestClient(app) as client:
        response = client.request(method, path, headers=headers, content=b'{"amount":0.1}')
    assert response.status_code == 409
    assert response.json()["error"] == "CLIENT_UPDATE_REQUIRED"
    assert response.json()["message"]
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Access-Control-Allow-Origin"] == headers["Origin"]
    assert calls == []


@pytest.mark.parametrize("path,method", [
    ("/api/v1/accounts", "GET"), ("/api/v1/transactions", "POST"),
    ("/api/v1/auth/config", "GET"), ("/api/v1/healthz", "GET"),
    ("/api/v1/documents", "GET"), ("/api/v1/support/overview", "GET"),
    ("/api/v1/sms/bridge-ingest", "POST"), ("/api/v1/inventory", "PATCH"),
    ("/api/v1/shopping/offline", "GET"),
    ("/api/v1/shopping/offline/mutations", "POST"),
    ("/api/v1/accounts-extra", "POST"), ("/api/v1/vehicles/id", "PATCH"),
])
def test_current_and_nonfinancial_calls_reach_existing_handler(path, method):
    async def handler(request):
        return JSONResponse({"amount": "0.01"})
    app = Starlette(routes=[Route(path, handler, methods=[method])])
    app.add_middleware(FinancialContractMiddleware)
    headers = {HEADER: CONTRACT} if path in ("/api/v1/accounts", "/api/v1/transactions") else {}
    with TestClient(app) as client:
        assert client.request(method, path, headers=headers).json() == {"amount": "0.01"}


def test_real_app_cors_allows_new_contract_and_gate_errors(monkeypatch):
    from app.core.config import settings
    from app.main import create_app
    monkeypatch.setattr(settings, "cors_origins", "https://pwa.khaanehyar.ir")
    with TestClient(create_app()) as client:
        response = client.options("/api/v1/accounts", headers={
            "Origin": "https://pwa.khaanehyar.ir", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": HEADER + ", Authorization, Content-Type",
        })
        assert response.status_code == 200
        assert HEADER.lower() in response.headers["Access-Control-Allow-Headers"].lower()
        response = client.get("/api/v1/accounts", headers={"Origin": "https://pwa.khaanehyar.ir"})
        assert response.status_code == 409
        assert response.headers["Access-Control-Allow-Origin"] == "https://pwa.khaanehyar.ir"
        denied = client.options("/api/v1/accounts", headers={
            "Origin": "https://untrusted.invalid", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": HEADER,
        })
        assert denied.status_code == 400


def test_rejected_old_account_write_preserves_history_and_revision(client, home_a, database):
    from sqlalchemy import text
    from tests.test_wallet_corrections import wallet, balance, history
    account = wallet(client, home_a, "1000.1")
    before = balance(client, home_a, account)
    response = client.patch(f"/api/v1/accounts/{account['id']}",
                            headers={**home_a.h, HEADER: ""},
                            json={"initial_balance": 1000})
    assert response.status_code == 409
    assert balance(client, home_a, account) == before
    assert history(client, home_a, account) == []
    with database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM transactions")) == 0


@pytest.mark.parametrize("headers", [
    [(HEADER, CONTRACT), (HEADER, CONTRACT)],
    [(HEADER, CONTRACT), (HEADER.lower(), "numeric-v0")],
    [(HEADER, "")],
])
def test_duplicate_or_empty_capability_is_not_accepted(headers):
    async def handler(request):
        raise AssertionError("Ambiguous old-client request reached a financial handler")
    app = Starlette(routes=[Route("/api/v1/accounts", handler)])
    app.add_middleware(FinancialContractMiddleware)
    with TestClient(app) as client:
        assert client.get("/api/v1/accounts", headers=headers).status_code == 409


def test_real_raw_sms_bridge_keeps_its_original_validation_without_capability(client):
    response = client.post("/api/v1/sms/bridge-ingest", headers={HEADER: ""}, json={})
    assert response.status_code == 401
    assert response.json()["error"] == "UNAUTHORIZED"
    assert client.post("/api/v1/sms/ingest", headers={HEADER: ""}, json={}).status_code == 409
