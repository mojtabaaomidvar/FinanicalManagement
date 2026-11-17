"""Check real HTTP transaction permissions using disposable sandbox data only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from local_sandbox import (
    SANDBOX_ACCOUNTS,
    SANDBOX_FAMILY_ID,
    SANDBOX_PASSWORD,
    SandboxError,
    configure_sandbox,
    report_failure,
    require_sandbox_database,
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SandboxError(message)


def check() -> None:
    configure_sandbox()
    import httpx

    from app.db.session import SessionLocal
    from app.models.family import Family
    from app.services import password_reset, sms

    require(not sms.is_configured(), "SMS delivery is not disabled.")

    with SessionLocal() as db:
        require_sandbox_database(db)
        require(db.get(Family, SANDBOX_FAMILY_ID) is not None, "Sandbox seed marker missing.")

    tokens: list[str] = []
    disposable: list[str] = []
    owner_headers = None
    cleanup_errors: list[str] = []
    with httpx.Client(
        base_url="http://127.0.0.1:5700/api/v1", timeout=20,
        follow_redirects=False, trust_env=False,
    ) as client:
        def request(method, path, headers=None, payload=None, expected=200):
            response = client.request(method, path, headers=headers, json=payload)
            require(response.status_code == expected,
                    f"{method} {path}: expected {expected}, received {response.status_code}.")
            return response.json() if response.content else None

        def login(phone, role):
            result = request("POST", "/auth/login", payload={
                "phone": phone, "password": SANDBOX_PASSWORD,
            })
            token = result["session_token"]
            tokens.append(token)
            require(result["family"]["id"] == str(SANDBOX_FAMILY_ID),
                    "HTTP proxy did not return the dedicated sandbox family.")
            require(result["member"]["role"] == role, f"Unexpected role for {phone}.")
            headers = {"Authorization": f"Bearer {token}"}
            session = request("GET", "/auth/session", headers=headers)
            require(session["member"]["id"] == result["member"]["id"],
                    "Session identity was not preserved.")
            return result["member"], headers

        def persisted(tx_id):
            rows = request("GET", "/transactions", headers=owner_headers)
            row = next((item for item in rows if item["id"] == tx_id), None)
            require(row is not None, "Disposable transaction was not persisted.")
            return row

        try:
            config = request("GET", "/auth/config")
            require(config["otp_enabled"] is False, "Sandbox unexpectedly requires OTP.")
            # Development can reset via a logged code without sending an SMS.
            require(config["password_reset_enabled"] == password_reset.is_available(),
                    "Unexpected password reset configuration.")
            owner, owner_headers = login(SANDBOX_ACCOUNTS[0][0], "owner")
            member1, member1_headers = login(SANDBOX_ACCOUNTS[1][0], "member")
            member2, member2_headers = login(SANDBOX_ACCOUNTS[2][0], "member")
            _, admin_headers = login(SANDBOX_ACCOUNTS[3][0], "admin")
            today = datetime.now(timezone(timedelta(hours=3, minutes=30))).date().isoformat()

            def create(member, headers):
                payload = {
                    "member_id": member["id"], "type": "expense", "amount": 10000,
                    "category": "other-e", "date": today, "repeat": "none",
                    "note": "تراکنش موقت بررسی خودکار محیط تست",
                }
                row = request("POST", "/transactions", headers=headers,
                              payload=payload, expected=201)
                disposable.append(row["id"])
                return row["id"], payload

            own_id, own_payload = create(member1, member1_headers)
            other_id, other_payload = create(member2, member2_headers)
            own_payload["amount"] = 12000
            request("PATCH", f"/transactions/{own_id}", headers=member1_headers,
                    payload=own_payload, expected=204)
            require(persisted(own_id)["amount"] == 12000, "Own edit did not persist.")

            rejected_payload = {**other_payload, "amount": 99999}
            request("PATCH", f"/transactions/{other_id}", headers=member1_headers,
                    payload=rejected_payload, expected=404)
            require(persisted(other_id)["amount"] == 10000, "Denied edit changed stored data.")
            request("PATCH", f"/transactions/{own_id}", headers=member1_headers,
                    payload={**own_payload, "member_id": member2["id"]}, expected=403)
            own_row = persisted(own_id)
            require(own_row["member_id"] == member1["id"] and own_row["amount"] == 12000,
                    "Denied reassignment changed stored data.")

            other_payload["amount"] = 13000
            request("PATCH", f"/transactions/{other_id}", headers=owner_headers,
                    payload=other_payload, expected=204)
            require(persisted(other_id)["amount"] == 13000, "Owner edit did not persist.")
            other_payload["amount"] = 14000
            request("PATCH", f"/transactions/{other_id}", headers=admin_headers,
                    payload=other_payload, expected=204)
            require(persisted(other_id)["amount"] == 14000, "Admin edit did not persist.")
            print("PASS: real logins, session identity, own edit and persistence, "
                  "foreign edit 404, reassignment 403, owner/admin edits.")
        finally:
            # Only IDs returned by this run are touched; seeded and user-created
            # records, passwords, account balances and browser sessions remain intact.
            for tx_id in disposable:
                try:
                    response = client.delete(f"/transactions/{tx_id}", headers=owner_headers)
                    if response.status_code != 204:
                        cleanup_errors.append(f"transaction {tx_id}")
                except httpx.HTTPError:
                    cleanup_errors.append(f"transaction {tx_id}")
            for token in tokens:
                try:
                    response = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
                    if response.status_code != 200:
                        cleanup_errors.append("check session")
                except httpx.HTTPError:
                    cleanup_errors.append("check session")
            if cleanup_errors:
                raise SandboxError("Cleanup incomplete: " + ", ".join(cleanup_errors))
    print("PASS: disposable check transactions and sessions removed; manual data preserved.")


if __name__ == "__main__":
    try:
        check()
    except Exception as exc:
        report_failure(exc)
        raise SystemExit(1) from None
