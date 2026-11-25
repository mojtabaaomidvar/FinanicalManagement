"""Separate operator credentials with Argon2id, TOTP replay protection and session revocation."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.management.contracts import ManagementError
from app.management.store import Store

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
# A real dummy hash makes unknown-account verification follow the same expensive path.
DUMMY_HASH = hasher.hash(secrets.token_hex(32))
COOKIE = "khaneyar_management"
COOKIE_PATH = "/management/api"
SESSION_SECONDS = 1800


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def totp(secret: str, step: int | None = None) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(
        key, struct.pack(">Q", int(time.time() // 30) if step is None else step), hashlib.sha1
    ).digest()
    offset = digest[-1] & 15
    return str((struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(
        6
    )


def verify_credential(
    db, account, password: str, code: str, production: bool, *, recent_mfa: bool = False
):
    valid = False
    try:
        valid = hasher.verify(account["password_hash"] if account else DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        pass
    if not account or not account["enabled"] or not valid:
        raise ManagementError("LOGIN_FAILED", "نام کاربری، رمز یا کد دومرحله‌ای درست نیست.", 401)
    secret = account["totp_secret"]
    if production and not secret:
        raise ManagementError(
            "MFA_REQUIRED", "برای این حساب، ورود دومرحله‌ای را از راه‌انداز مدیریت فعال کنید.", 403
        )
    if secret and not recent_mfa:
        now_step = int(time.time() // 30)
        match = next(
            (
                step
                for step in (now_step - 1, now_step, now_step + 1)
                if step > account["last_totp"] and hmac.compare_digest(totp(secret, step), code)
            ),
            None,
        )
        if match is None:
            raise ManagementError("LOGIN_FAILED", "نام کاربری، رمز یا کد دومرحله‌ای درست نیست.", 401)
        db.execute("UPDATE accounts SET last_totp=? WHERE id=?", (match, account["id"]))


def create_account(
    store: Store,
    username: str,
    password: str,
    role: str,
    *,
    production: bool,
    actor: str = "bootstrap",
    secret: str = "",
) -> dict:
    if (
        not re.fullmatch(r"[a-zA-Z0-9_.-]{3,64}", username)
        or len(password) < 12
        or len(password) > 128
    ):
        raise ManagementError(
            "INVALID_ACCOUNT", "نام کاربری باید لاتین و رمز دست‌کم دوازده نویسه باشد.", 422
        )
    if role not in {"owner", "operator", "viewer"}:
        raise ManagementError("INVALID_ROLE", "نقش مدیر معتبر نیست.", 422)
    secret = secret or (
        base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=") if production else ""
    )
    account_id = str(uuid4())
    password_hash = hasher.hash(password)
    with store.connect() as db:
        if db.execute("SELECT 1 FROM accounts WHERE username=?", (username,)).fetchone():
            raise ManagementError("USERNAME_EXISTS", "این نام کاربری قبلاً ثبت شده است.", 409)
        db.execute(
            "INSERT INTO accounts(id,username,password_hash,role,totp_secret,created) "
            "VALUES (?,?,?,?,?,?)",
            (account_id, username, password_hash, role, secret, time.time()),
        )
        store.audit(db, actor, "account.created", {"username": username, "role": role})
    return {"id": account_id, "username": username, "role": role, "totp_secret": secret}


def login(store: Store, username: str, password: str, code: str, ip: str, production: bool):
    store.rate_limit(ip, username)
    raw = secrets.token_hex(32)
    csrf = secrets.token_hex(32)
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        account = db.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
        verify_credential(db, account, password, code, production)
        db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?)",
            (token_hash(raw), account["id"], csrf, time.time() + SESSION_SECONDS, time.time()),
        )
        store.audit(db, account["username"], "session.login")
    return raw


def session(store: Store, raw: str):
    if not re.fullmatch(r"[a-f0-9]{64}", raw):
        return None
    with store.connect() as db:
        row = db.execute(
            """SELECT a.id,a.username,a.role,a.totp_secret,s.csrf,s.token,s.expires
            FROM sessions s JOIN accounts a ON a.id=s.account_id
            WHERE s.token=? AND s.expires>? AND a.enabled=1""",
            (token_hash(raw), time.time()),
        ).fetchone()
        return dict(row) if row else None


def update_account(
    store: Store, actor: dict, account_id: str, role: str, enabled: bool, password: str
):
    if actor["role"] != "owner":
        raise ManagementError("FORBIDDEN", "فقط مالک پنل می‌تواند حساب مدیران را تغییر دهد.", 403)
    if role not in {"owner", "operator", "viewer"} or (password and not 12 <= len(password) <= 128):
        raise ManagementError("INVALID_ACCOUNT", "نقش یا رمز تازه معتبر نیست.", 422)
    new_hash = hasher.hash(password) if password else None
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not old:
            raise ManagementError("NOT_FOUND", "حساب مدیریت پیدا نشد.", 404)
        if account_id == actor["id"] and (not enabled or role != "owner"):
            raise ManagementError(
                "SELF_LOCKOUT", "حساب جاری نمی‌تواند دسترسی مالک خودش را حذف کند.", 409
            )
        owners = db.execute(
            "SELECT count(*) FROM accounts WHERE role='owner' AND enabled=1"
        ).fetchone()[0]
        if (
            old["role"] == "owner"
            and old["enabled"]
            and (not enabled or role != "owner")
            and owners <= 1
        ):
            raise ManagementError("LAST_OWNER", "دست‌کم یک مالک فعال باید باقی بماند.", 409)
        db.execute(
            "UPDATE accounts SET role=?,enabled=?,password_hash=? WHERE id=?",
            (role, int(enabled), new_hash or old["password_hash"], account_id),
        )
        db.execute("DELETE FROM sessions WHERE account_id=?", (account_id,))
        store.audit(
            db,
            actor["username"],
            "account.updated",
            {
                "username": old["username"],
                "role": role,
                "enabled": enabled,
                "password_changed": bool(password),
            },
        )
