"""Exercise the production report SQL in a NEW native PostgreSQL cluster, never the manual DB."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from app.management.analytics import read_analytics
from app.management.ai_analytics import read_ai_analytics

NOW = datetime(2026, 11, 25, 8, 42, tzinfo=UTC)
PRIVATE = "private-financial-and-document-content"
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def native_postgres():
    if os.name != "nt":
        pytest.skip(
            "Set up the native PostgreSQL fixture for this host before running SQL integration tests."
        )
    config = ROOT / ".local-test/config.json"
    configured = os.environ.get("MANAGEMENT_TEST_PG_BIN", "")
    if not configured and config.is_file():
        configured = json.loads(config.read_text(encoding="utf-8-sig")).get("PgBin", "")
    binary = Path(configured)
    if not configured or not (binary / "initdb.exe").is_file():
        pytest.skip("Native PostgreSQL binaries are unavailable; no application database was used.")
    scratch = Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="management-analytics-pg-", dir=scratch) as temporary:
        directory = Path(temporary)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(
            [
                str(binary / "initdb.exe"),
                "-D",
                str(directory / "data"),
                "-U",
                "analytics_test",
                "--auth=trust",
                "--encoding=UTF8",
                "--locale=C",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=True,
            creationflags=flags,
            timeout=45,
        )
        try:
            subprocess.run(
                [
                    str(binary / "pg_ctl.exe"),
                    "-D",
                    str(directory / "data"),
                    "-l",
                    str(directory / "postgres.log"),
                    "-o",
                    f"-h 127.0.0.1 -p {port} -c timezone=UTC",
                    "-w",
                    "-t",
                    "30",
                    "start",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                creationflags=flags,
                timeout=45,
            )
            base = [
                str(binary / "psql.exe"),
                "-X",
                "-w",
                "-qAt",
                "-h",
                "127.0.0.1",
                "-p",
                str(port),
                "-U",
                "analytics_test",
                "-v",
                "ON_ERROR_STOP=1",
            ]

            def execute(statement, parameters=None, database="postgres"):
                command = (
                    base
                    + ["-d", database]
                    + ["--set=" + key + "=" + value for key, value in (parameters or {}).items()]
                )
                result = subprocess.run(
                    command,
                    input=statement,
                    text=True,
                    encoding="utf-8",
                    capture_output=True,
                    check=True,
                    timeout=30,
                    creationflags=flags,
                )
                return result.stdout.strip()

            yield execute
        finally:
            subprocess.run(
                [
                    str(binary / "pg_ctl.exe"),
                    "-D",
                    str(directory / "data"),
                    "-m",
                    "fast",
                    "-w",
                    "-t",
                    "30",
                    "stop",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                creationflags=flags,
                timeout=45,
            )


SCHEMA = """
CREATE TABLE families (id int PRIMARY KEY, name text, created_at timestamptz NOT NULL);
CREATE TABLE members (id int PRIMARY KEY, family_id int REFERENCES families(id), name text, phone text,
    password_hash text, status text NOT NULL, membership_state text NOT NULL,
    support_registered_at timestamptz, support_last_login_at timestamptz);
CREATE TABLE support_usage_counters (hour timestamptz, module text, action text, count bigint);
CREATE TABLE support_error_counters (hour timestamptz, kind text, http_family text, count bigint);
CREATE TABLE transactions (repeat text, amount numeric, description text);
CREATE TABLE tasks (completed bool, title text);
CREATE TABLE shopping_lists (title text);
CREATE TABLE documents (content text);
CREATE TABLE inventory_items (name text, private_notes text);
CREATE TABLE accounts (card_number text, balance numeric);
CREATE FUNCTION public.support_record_counts()
RETURNS TABLE (transactions bigint, scheduled_plans bigint, open_tasks bigint,
    completed_tasks bigint, shopping_lists bigint, documents bigint)
LANGUAGE sql STABLE AS $$ SELECT
    (SELECT count(*) FROM transactions WHERE repeat='none'),
    (SELECT count(*) FROM transactions WHERE repeat<>'none'),
    (SELECT count(*) FROM tasks WHERE NOT completed),
    (SELECT count(*) FROM tasks WHERE completed),
    (SELECT count(*) FROM shopping_lists), (SELECT count(*) FROM documents) $$;
INSERT INTO families VALUES
    (1,'private-family-name','2026-11-18T20:30:00Z'),
    (2,'private-family-name','2026-11-18T20:29:59Z'),
    (3,'private-family-name','2026-11-24T21:00:00Z'),
    (4,'private-family-name','2026-11-01T00:00:00Z'),
    (5,'empty-family','2026-10-01T00:00:00Z');
INSERT INTO members VALUES
    (1,1,'private-name','09123456789','private-password-hash','active','active','2026-11-18T20:30:00Z','2026-11-25T08:00:00Z'),
    (2,1,'private-name',NULL,NULL,'pending','pending',NULL,NULL),
    (3,2,'private-child',NULL,NULL,'active','active',NULL,NULL),
    (4,3,'private-name','09351234567','private-password-hash','active','pending','2026-11-25T00:00:00Z',NULL),
    (5,4,'private-name','09221234567','private-password-hash','active','suspended','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'),
    (6,4,'private-name','09191234567','private-password-hash','active','active',NULL,NULL);
INSERT INTO support_usage_counters VALUES
    ('2026-11-18T20:29:59Z','tasks','create',3),
    ('2026-11-18T20:30:00Z','tasks','open',7),
    ('2026-11-18T20:30:00Z','tasks','create',2),
    ('2026-11-24T21:00:00Z','shopping','complete',4),
    ('2026-11-25T08:42:00Z','tasks','create',100),
    ('2026-11-26T00:00:00Z','tasks','create',200);
INSERT INTO support_error_counters VALUES
    ('2026-11-18T20:30:00Z','login','client',2),
    ('2026-11-24T21:00:00Z','registration','server',1),
    ('2026-11-25T08:42:00Z','login','client',100);
INSERT INTO transactions VALUES ('none',999999,'private-financial-and-document-content'),('monthly',999999,'private-financial-and-document-content');
INSERT INTO tasks VALUES (false,'private-title'),(true,'private-title');
INSERT INTO shopping_lists VALUES ('private-shopping-content');
INSERT INTO documents VALUES ('private-financial-and-document-content');
INSERT INTO inventory_items VALUES ('private-inventory-item','private-notes');
INSERT INTO accounts VALUES ('1234567890123456',999999);
"""


@pytest.fixture
def sql(native_postgres):
    name = "management_analytics_" + uuid4().hex
    native_postgres('CREATE DATABASE "' + name + '";')

    def execute(statement, parameters=None):
        return native_postgres(statement, parameters, database=name)

    execute(SCHEMA)
    try:
        yield execute
    finally:
        native_postgres('DROP DATABASE "' + name + '";')


def test_real_sql_tehran_boundaries_counts_and_privacy(sql):
    report = read_analytics(sql, 7, NOW)
    snapshot = report["snapshot"]
    assert snapshot["families"] == 5 and snapshot["families_with_accounts"] == 3
    assert snapshot["profiles"] == 6 and snapshot["registered_accounts"] == 4
    assert snapshot["introduced_profiles"] == 1 and snapshot["managed_profiles"] == 1
    assert (
        snapshot["active_accounts"] == 2
        and snapshot["pending_accounts"] == 1
        and snapshot["inactive_accounts"] == 1
    )
    assert snapshot["accounts_with_login"] == 1 and snapshot["families_with_login"] == 1
    assert snapshot["accounts_without_login_history"] == 2
    assert snapshot["accounts_without_registration_history"] == 1
    assert report["record_inventory"]["inventory_items"] == 1
    assert report["record_inventory"]["wallets"] == 1
    assert report["record_inventory"]["vehicles"] is None
    assert report["daily"][0]["day"] == "2026-11-19"
    assert report["daily"][0]["families_created"] == 1
    assert report["daily"][-1]["families_created"] == 1
    assert report["usage"] == {"opens": 7, "requests": 6}
    assert report["lifetime_usage"] == {"opens": 7, "requests": 9}
    assert report["errors"] == {"login": 2, "registration": 1, "server": 1, "total": 3}
    assert sum(point["errors"] for point in report["daily"]) == 3
    assert report["records"] == {
        "transactions": 1,
        "scheduled_plans": 1,
        "open_tasks": 1,
        "completed_tasks": 1,
        "shopping_lists": 1,
        "documents": 1,
    }
    encoded = json.dumps(report)
    for private in (
        PRIVATE,
        "private-family-name",
        "private-name",
        "09123456789",
        "private-password-hash",
        "999999",
        "1234567890123456",
        "private-inventory-item",
    ):
        assert private not in encoded
    assert sql("SELECT count(*) FROM support_usage_counters;") == "6"
    assert sql("SELECT count(*) FROM members;") == "6"


def test_real_ai_sql_missing_empty_partial_and_existing_report_preserved(sql):
    before = read_analytics(sql, 7, NOW)
    assert read_ai_analytics(sql, 7, NOW)["totals"] is None
    sql("""CREATE TABLE support_ai_counters (
        hour timestamptz, stage text, status text, requests bigint,
        input_tokens bigint, output_tokens bigint, input_token_requests bigint, output_token_requests bigint);
    """)
    assert read_ai_analytics(sql, 7, NOW)["totals"]["requests"] == 0
    sql("""INSERT INTO support_ai_counters VALUES
        ('2026-11-18T20:29:59Z','sms','success',100,100,100,100,100),
        ('2026-11-18T20:30:00Z','sms','success',2,10,0,1,1),
        ('2026-11-25T07:30:00Z','assistant_plan','failure',1,0,0,0,0),
        ('2026-11-25T08:42:00Z','sms','success',200,200,200,200,200);
    """)
    report = read_ai_analytics(sql, 7, NOW)
    assert report["totals"] == {"requests": 3, "successes": 2, "failures": 1,
                                "input_tokens": 10, "output_tokens": 0,
                                "input_token_requests": 1, "output_token_requests": 1}
    assert read_analytics(sql, 7, NOW) == before
    assert sql("SELECT count(*) FROM support_ai_counters;") == "4"


def test_real_sql_missing_counters_are_not_zero(sql):
    sql(
        "DROP TABLE support_usage_counters; DROP TABLE support_error_counters; DROP FUNCTION support_record_counts();"
    )
    report = read_analytics(sql, 30, NOW)
    assert report["snapshot"]["families"] == 5
    assert (
        report["modules"] is None
        and report["usage"] is None
        and report["errors"] is None
        and report["records"] is None
    )
    assert all(
        point["opens"] is None and point["requests"] is None and point["errors"] is None
        for point in report["daily"]
    )


def test_real_sql_empty_available_counters_and_longer_period(sql):
    month = read_analytics(sql, 30, NOW)
    assert month["usage"]["requests"] == 9
    assert len(month["daily"]) == 30
    sql("TRUNCATE support_usage_counters, support_error_counters;")
    empty = read_analytics(sql, 90, NOW)
    assert len(empty["daily"]) == 90
    assert empty["usage"] == {"opens": 0, "requests": 0}
    assert empty["errors"]["total"] == 0
    assert empty["measurement"]["first_usage_counter"] is None
