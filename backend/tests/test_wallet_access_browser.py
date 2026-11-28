"""Log into the production PWA with disposable PostgreSQL accounts only."""
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import uvicorn

from tests.conftest import API, PASSWORD, expect_status, make_account


def test_wallet_login_and_private_transfer_in_built_pwa(client, home_a, member_a):
    from app.main import create_app

    root = Path(__file__).resolve().parents[2]
    source = expect_status(client.post(f"{API}/accounts", headers=member_a.h, json={
        "member_id": member_a.member_id, "title": "Personal cash", "kind": "wallet", "initial_balance": "1000",
    }), 201).json()["id"]
    destination = make_account(client, home_a, "Private peer cash", "wallet")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=listener.getsockname()[1], log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            threading.Event().wait(.05)
        assert server.started
        context = {"backend": f"http://127.0.0.1:{listener.getsockname()[1]}", "password": PASSWORD,
                   "owner": {"phone": home_a.phone, "token": home_a.token},
                   "member": {"phone": member_a.phone, "token": member_a.token},
                   "source": source, "destination": destination}
        result = subprocess.run(["node", "scripts/check-wallet-access-live.mjs"], cwd=root,
            env={**os.environ, "WALLET_BROWSER_CONTEXT": json.dumps(context)},
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        assert result.returncode == 0, result.stdout + result.stderr
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()
