"""Run the built PWA against the disposable database, never the manual sandbox."""
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time

import uvicorn

from tests.conftest import PASSWORD


def test_household_members_receive_silent_updates_in_real_browsers(client, home_a, member_a, home_b):
    from app.main import create_app
    root = Path(__file__).resolve().parents[2]
    assert (root / 'dist/index.html').is_file(), 'Build the current PWA before this browser check.'
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(), host='127.0.0.1', port=port, log_level='warning'))
    thread = threading.Thread(target=server.run, kwargs={'sockets':[listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            threading.Event().wait(.05)
        assert server.started
        actors = {key:{'phone':actor.phone,'token':actor.token} for key, actor in
                  [('owner',home_a),('member',member_a),('other',home_b)]}
        context = {'backend':f'http://127.0.0.1:{port}', 'password':PASSWORD, **actors}
        result = subprocess.run(['node', 'scripts/check-household-live.mjs'], cwd=root,
            env={**os.environ, 'HOUSEHOLD_BROWSER_CONTEXT':json.dumps(context)},
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=150)
        assert result.returncode == 0, result.stdout + result.stderr
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()
