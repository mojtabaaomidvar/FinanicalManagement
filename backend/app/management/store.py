"""Private management identity, session, audit and job state (no application database)."""

from __future__ import annotations

import contextlib
import hashlib
import json
import secrets
import sqlite3
import time
from pathlib import Path

from app.management.contracts import ManagementError


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "management.sqlite3"
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL, role TEXT NOT NULL,
                    totp_secret TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
                    last_totp INTEGER NOT NULL DEFAULT -1, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY, account_id TEXT NOT NULL, csrf TEXT NOT NULL,
                    expires REAL NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS attempts (scope TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS attempts_scope ON attempts(scope, created);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, account_id TEXT NOT NULL,
                    request_key TEXT NOT NULL, operation TEXT NOT NULL,
                    status TEXT NOT NULL, result TEXT, created REAL NOT NULL, finished REAL,
                    UNIQUE(account_id, request_key));
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL,
                    detail TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.execute(
                "INSERT OR IGNORE INTO metadata VALUES ('ip_salt', ?)", (secrets.token_hex(32),)
            )
        self.path.chmod(0o600)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA busy_timeout=10000")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def audit(self, db, actor: str, event: str, detail: dict | None = None):
        db.execute(
            "INSERT INTO audit(actor,event,detail,created) VALUES (?,?,?,?)",
            (actor, event, json.dumps(detail or {}, ensure_ascii=False), time.time()),
        )

    def rate_limit(self, ip: str, username: str, namespace: str = "login"):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            salt = db.execute("SELECT value FROM metadata WHERE key='ip_salt'").fetchone()[0]
            ip_scope = hashlib.sha256((salt + ip).encode()).hexdigest()
            name_scope = hashlib.sha256((salt + username).encode()).hexdigest()
            scopes = (
                (namespace + ":ip:" + ip_scope, 10),
                (namespace + ":user:" + name_scope, 10),
                (namespace + ":global", 240 if namespace == "reauth" else 60),
            )
            db.execute("DELETE FROM attempts WHERE created < ?", (time.time() - 900,))
            for scope, limit in scopes:
                if (
                    db.execute("SELECT count(*) FROM attempts WHERE scope=?", (scope,)).fetchone()[
                        0
                    ]
                    >= limit
                ):
                    raise ManagementError(
                        "RATE_LIMITED",
                        "تعداد تلاش‌ها زیاد است؛ پانزده دقیقه بعد دوباره تلاش کنید.",
                        429,
                    )
            db.executemany(
                "INSERT INTO attempts VALUES (?,?)", [(scope, time.time()) for scope, _ in scopes]
            )
            return [scope for scope, _ in scopes[:2]]

    def recover(self):
        with self.connect() as db:
            db.execute(
                "UPDATE jobs SET status='interrupted', finished=? "
                "WHERE status IN ('queued','running')",
                (time.time(),),
            )
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))

    def jobs(self):
        with self.connect() as db:
            return [
                self.job_out(row)
                for row in db.execute("SELECT * FROM jobs ORDER BY created DESC LIMIT 100")
            ]

    @staticmethod
    def job_out(row):
        result = dict(row)
        result["operation"] = json.loads(result["operation"])
        result["result"] = json.loads(result["result"]) if result["result"] else None
        del result["request_key"]
        del result["account_id"]
        return result
