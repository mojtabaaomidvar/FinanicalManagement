"""Exercise meal selection in the real PWA on disposable PostgreSQL only."""
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import uvicorn

from tests.conftest import PASSWORD


def test_meal_inventory_flow_in_mobile_and_desktop_browsers(client, home_a):
    from app.main import create_app
    root = Path(__file__).resolve().parents[2]
    assert (root / "dist/index.html").is_file()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    config = uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            threading.Event().wait(.05)
        assert server.started
        context = {"backend": f"http://127.0.0.1:{port}", "password": PASSWORD,
                   "owner": {"phone": home_a.phone, "token": home_a.token}}
        node = shutil.which("node")
        assert node is not None
        result = subprocess.run([node, "scripts/check-meal-inventory.mjs"], cwd=root,
            env={**os.environ, "MEAL_BROWSER_CONTEXT": json.dumps(context)},
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        assert result.returncode == 0, result.stdout + result.stderr
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()
