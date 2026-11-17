"""Shared isolation checks for the opt-in local manual test environment."""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
SANDBOX_FAMILY_ID = uuid.UUID("da900000-0000-4000-8000-000000000001")
SANDBOX_PASSWORD = "Test12345!"  # noqa: S105 - Public password for isolated synthetic accounts.
SANDBOX_ACCOUNTS = (
    ("09000000001", "مدیر آزمایشی", "owner"),
    ("09000000002", "عضو اول آزمایشی", "member"),
    ("09000000003", "عضو دوم آزمایشی", "member"),
    ("09000000004", "مدیر دوم آزمایشی", "admin"),
)
RLS_TABLES = frozenset({
    "transactions", "transaction_photos", "accounts", "subcategories",
    "custom_categories", "category_budgets", "sms_messages", "family_events",
    "holdings", "sms_senders", "sms_numbers", "join_requests",
    "notification_dismissals", "bills", "shopping_lists", "inventory_items",
    "shopping_items", "shopping_sync_receipts", "tasks", "documents",
    "meal_dishes", "meal_entries",
    "home_equipment", "maintenance_records", "vehicles",
    "goals",
    "activity_participants",
    "pets",
})


class SandboxError(RuntimeError):
    """An actionable error that contains no connection secrets."""


def configure_sandbox():
    """Replace dotenv-derived settings before importing any database or API module."""
    if os.environ.get("APP_ENV") != "local-sandbox":
        raise SandboxError("APP_ENV must be local-sandbox; no changes were made.")
    try:
        url = make_url(os.environ.get("DATABASE_URL", ""))
    except Exception:
        raise SandboxError("A valid local sandbox DATABASE_URL is required.") from None
    if (
        url.drivername != "postgresql+psycopg"
        or url.host != "127.0.0.1"
        or url.port != 55439
        or url.database != "khaneyar_local_sandbox"
        or url.username != "khaneyar_sandbox"
        or url.query
    ):
        raise SandboxError("Refusing any database except the dedicated loopback sandbox.")

    expected_uploads = (PROJECT_DIR / ".local-test" / "uploads").resolve()
    configured_uploads = Path(os.environ.get("STORAGE_DIR", str(expected_uploads))).resolve()
    if configured_uploads != expected_uploads:
        raise SandboxError("STORAGE_DIR must be the private .local-test/uploads directory.")
    os.environ["STORAGE_DIR"] = str(expected_uploads)
    # Empty variables disappear in Windows PowerShell 5. Set them in Python so
    # Settings can never fall back to credentials in backend/.env.
    for key in (
        "SMS_API_KEY", "SMS_PROVIDER", "SMS_SENDER", "SMS_TEMPLATE",
        "STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY",
        "STORAGE_SECRET_KEY", "BRSAPI_KEY", "FILES_BASE_URL",
    ):
        os.environ[key] = ""
    os.environ["CORS_ORIGINS"] = "http://127.0.0.1:5700,http://localhost:5700"
    os.environ["DEBUG"] = "false"
    for key in ("FILE_SIGNING_SECRET", "RATE_LIMIT_SALT", "DOCUMENT_ENCRYPTION_KEY"):
        if not os.environ.get(key):
            raise SandboxError(f"The launcher must supply {key} for the sandbox.")
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    from app.core.config import Settings, settings

    isolated = Settings(_env_file=None)
    # Existing modules refer to this shared object; keep its identity intact.
    for field in Settings.model_fields:
        setattr(settings, field, getattr(isolated, field))
    return settings


def require_sandbox_database(db) -> None:
    """Verify the effective PostgreSQL role and all migrated family RLS tables."""
    row = db.execute(text(
        "SELECT current_user AS username, current_database() AS database, "
        "host(inet_server_addr()) AS address, inet_server_port() AS port, "
        "rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    )).mappings().one()
    if (
        row["username"] != "khaneyar_sandbox"
        or row["database"] != "khaneyar_local_sandbox"
        or row["address"] != "127.0.0.1"
        or row["port"] != 55439
        or row["rolsuper"] or row["rolbypassrls"]
    ):
        raise SandboxError("Sandbox requires its dedicated NOSUPERUSER/NOBYPASSRLS role.")
    if db.execute(text("SHOW row_security")).scalar_one() != "on":
        raise SandboxError("PostgreSQL row_security must remain enabled.")
    from alembic.script import ScriptDirectory

    expected_revisions = set(ScriptDirectory(str(BACKEND_DIR / "alembic")).get_heads())
    actual_revisions = set(db.execute(text("SELECT version_num FROM alembic_version")).scalars())
    if actual_revisions != expected_revisions:
        raise SandboxError("Run sandbox migrations through the current Alembic head first.")
    rows = db.execute(text(
        "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
        "EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'r'"
    )).mappings()
    protected = {
        row["relname"] for row in rows
        if row["relrowsecurity"] and row["relforcerowsecurity"] and row["has_policy"]
    }
    missing = sorted(RLS_TABLES - protected)
    if missing:
        raise SandboxError("Missing FORCE RLS or policy: " + ", ".join(missing))


def report_failure(exc: Exception) -> None:
    detail = str(exc) if isinstance(exc, SandboxError) else type(exc).__name__
    print(f"FAIL: {detail}", file=sys.stderr)
