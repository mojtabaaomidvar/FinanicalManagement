"""AI/usage regressions in a fresh native PostgreSQL cluster with synthetic AI only."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Temp/opencode"
SCRATCH.mkdir(parents=True, exist_ok=True)
configured = os.environ.get("MANAGEMENT_TEST_PG_BIN", "")
if not configured:
    config = ROOT / ".local-test/config.json"
    configured = json.loads(config.read_text(encoding="utf-8-sig")).get("PgBin", "") if config.is_file() else ""
binary = Path(configured)
if not configured or not (binary / "initdb.exe").is_file():
    raise SystemExit("Set MANAGEMENT_TEST_PG_BIN to native PostgreSQL binaries. No existing database is used.")
flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run(args, **kwargs):
    return subprocess.run(args, creationflags=flags, check=True, timeout=120, **kwargs)


with tempfile.TemporaryDirectory(prefix="ai-analytics-test-", dir=SCRATCH) as temporary:
    cluster = Path(temporary)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    started = False
    try:
        run([str(binary / "initdb.exe"), "-D", str(cluster / "data"), "-U", "analytics_bootstrap", "--auth=trust", "--encoding=UTF8", "--locale=C"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        run([str(binary / "pg_ctl.exe"), "-D", str(cluster / "data"), "-l", str(cluster / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port} -c timezone=UTC", "-w", "-t", "30", "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = True
        base = [str(binary / "psql.exe"), "-X", "-w", "-h", "127.0.0.1", "-p", str(port), "-U", "analytics_bootstrap", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
        run(base + ["-c", "CREATE ROLE analytics_app LOGIN NOSUPERUSER NOBYPASSRLS;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        run(base + ["-c", "CREATE DATABASE khaneyar_ai_test OWNER analytics_app;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        environment = os.environ.copy()
        environment.update({
            "APP_ENV": "test", "DEBUG": "false", "PYTHONUTF8": "1", "TEMP": str(SCRATCH), "TMP": str(SCRATCH),
            "DATABASE_URL": f"postgresql+psycopg://analytics_app@127.0.0.1:{port}/unused",
            "TEST_DATABASE_URL": f"postgresql+psycopg://analytics_app@127.0.0.1:{port}/khaneyar_ai_test",
            "TEST_MIGRATION_DATABASE_URL": f"postgresql+psycopg://analytics_bootstrap@127.0.0.1:{port}/khaneyar_ai_test",
            "STORAGE_ENDPOINT": "", "STORAGE_BUCKET": "", "SMS_PROVIDER": "", "SMS_API_KEY": "",
            "BRSAPI_KEY": "", "OPENROUTER_API_KEY": "", "AI_SMS_GATEWAY_URL": "", "AI_SMS_GATEWAY_TOKEN": "", "DEEPSEEK_API_KEY": "",
            "FILE_SIGNING_SECRET": "test-only-signing-secret", "RATE_LIMIT_SALT": "test-only-rate-limit-salt",
        })
        selected = sys.argv[1:] or ["tests/test_ai_usage.py", "tests/test_ai_controls.py", "tests/test_support_usage.py", "tests/test_shopping_offline.py",
                    "tests/test_tasks.py", "tests/test_household_transport_integration.py", "tests/test_household_assistant.py",
                    "tests/test_household_context.py", "ai_gateway/tests"]
        result = subprocess.run([sys.executable, "-u", "-m", "pytest", *selected, "-o", "addopts=", "-q", "--tb=short", "--maxfail=3"],
                                cwd=ROOT / "backend", env=environment, creationflags=flags,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", timeout=600, check=False)
        (SCRATCH / "ai-analytics-backend.log").write_text(result.stdout, encoding="utf-8")
        print("\n".join(result.stdout.splitlines()[-180:]))
    finally:
        if started:
            run([str(binary / "pg_ctl.exe"), "-D", str(cluster / "data"), "-m", "fast", "-w", "-t", "30", "stop"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    raise SystemExit(result.returncode)
