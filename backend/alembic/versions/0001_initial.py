"""initial schema — همهٔ ۱۸ جدول خانه‌یار (شامل رفع D-7)

این مهاجرت DDL کانونی را از نو و تمیز می‌سازد (بدون آرتیفکت‌های سوپابیس مثل
SECURITY DEFINER RPCها و گرنت‌های PostgREST). داده‌ها در فاز ۱۰ (data-only) بار می‌شوند.

رفع D-7: قید نوع تراکنش اکنون 'transfer' را می‌پذیرد
(در سوپابیس تنها ('expense','income') بود و ثبت انتقال خطا می‌داد).

نکتهٔ امنیتی: پالیسی‌های RLS واقعی در فاز ۵ اضافه می‌شوند؛ این مهاجرت فقط ساختار است.

Revision ID: 0001
Revises:
Create Date: 2026-09-07
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def upgrade() -> None:
    # gen_random_uuid() در PG13+ در هسته است؛ pgcrypto برای اطمینان روی نسخه‌های قدیمی‌تر.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ── families ──────────────────────────────────────────────
    op.create_table(
        "families",
        _uuid_pk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("budget", sa.Numeric(15, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("currency", sa.Text(), server_default=sa.text("'تومان'"), nullable=False),
        sa.Column("dark", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_families"),
        sa.UniqueConstraint("code", name="uq_families_code"),
    )

    # ── members ───────────────────────────────────────────────
    op.create_table(
        "members",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default=sa.text("'member'"), nullable=False),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        _created_at(),
        sa.Column("gender", sa.Text(), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        # national_id بازنشسته شد (درخواست مالک ۲۰۲۶-۰۹-۰۸): کدملی از برنامه حذف شد.
        # sa.Column("national_id", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        sa.Column("theme", sa.Text(), server_default=sa.text("'auto'"), nullable=False),
        sa.Column("relation", sa.Text(), server_default=sa.text("'خودم'"), nullable=False),
        sa.Column("currency", sa.Text(), server_default=sa.text("'تومان'"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_members"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_members_family_id_families", ondelete="CASCADE",
        ),
        sa.CheckConstraint("gender IS NULL OR gender IN ('male','female')", name="ck_members_gender"),
        sa.CheckConstraint("status IN ('pending','active')", name="ck_members_status"),
        sa.CheckConstraint("theme IN ('light','dark','auto')", name="ck_members_theme"),
        sa.CheckConstraint("currency IN ('تومان','ریال')", name="ck_members_currency"),
    )
    # یکتاییِ شماره فقط برای مقادیر غیر-NULL (چند عضو بدون شماره مجاز است).
    op.create_index(
        "uq_members_phone", "members", ["phone"],
        unique=True, postgresql_where=sa.text("phone IS NOT NULL"),
    )

    # ── accounts ──────────────────────────────────────────────
    op.create_table(
        "accounts",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("bank", sa.Text(), nullable=True),
        sa.Column("card_number", sa.Text(), nullable=True),
        _created_at(),
        sa.Column("kind", sa.Text(), server_default=sa.text("'bank'"), nullable=False),
        sa.Column("initial_balance", sa.Numeric(18, 0), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_accounts_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_accounts_member_id_members", ondelete="CASCADE",
        ),
        sa.CheckConstraint("kind IN ('bank','wallet')", name="ck_accounts_kind"),
    )
    op.create_index("ix_accounts_family_id", "accounts", ["family_id"])

    # ── card_bins (دادهٔ مرجع ساکن؛ ردیف‌ها در فاز ۱۰ بار می‌شوند) ──
    op.create_table(
        "card_bins",
        sa.Column("bin", sa.Text(), nullable=False),
        sa.Column("bank", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("bin", name="pk_card_bins"),
        sa.CheckConstraint(r"bin ~ '^\d{6}$'", name="ck_card_bins_bin_format"),
    )

    # ── subcategories ─────────────────────────────────────────
    op.create_table(
        "subcategories",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_subcategories"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_subcategories_family_id_families", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("family_id", "category", "name", name="family_category_name"),
    )

    # ── transactions (رفع D-7 در قید type) ────────────────────
    op.create_table(
        "transactions",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("category", sa.Text(), server_default=sa.text("'other-e'"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        _created_at(),
        sa.Column("time", sa.Text(), nullable=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("to_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("subcategory_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repeat", sa.Text(), server_default=sa.text("'none'"), nullable=False),
        sa.Column("repeat_end", sa.Date(), nullable=True),
        sa.Column(
            "handled_occurrences", postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"), nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_transactions_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_transactions_member_id_members", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_transactions_account_id_accounts", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["to_account_id"], ["accounts.id"],
            name="fk_transactions_to_account_id_accounts", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["subcategory_id"], ["subcategories.id"],
            name="fk_transactions_subcategory_id_subcategories", ondelete="SET NULL",
        ),
        # D-7 FIX ↓ افزودن 'transfer'
        sa.CheckConstraint("type IN ('expense','income','transfer')", name="ck_transactions_type"),
        sa.CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        sa.CheckConstraint(
            "repeat IN ('none','weekly','monthly','yearly')", name="ck_transactions_repeat"
        ),
    )
    op.create_index("ix_transactions_family_id", "transactions", ["family_id"])
    op.create_index("ix_transactions_member_id", "transactions", ["member_id"])
    op.create_index("ix_transactions_date", "transactions", ["date"])
    op.create_index("ix_transactions_account_id", "transactions", ["account_id"])

    # ── transaction_photos ────────────────────────────────────
    op.create_table(
        "transaction_photos",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("caption", sa.Text(), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_transaction_photos"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_transaction_photos_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"],
            name="fk_transaction_photos_transaction_id_transactions", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_transaction_photos_member_id_members", ondelete="CASCADE",
        ),
    )
    op.create_index("ix_transaction_photos_transaction_id", "transaction_photos", ["transaction_id"])

    # ── sms_messages ──────────────────────────────────────────
    op.create_table(
        "sms_messages",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("bank", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("balance", sa.Numeric(15, 2), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_sms_messages"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_sms_messages_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_sms_messages_member_id_members", ondelete="SET NULL",
        ),
        sa.CheckConstraint("type IS NULL OR type IN ('expense','income')", name="ck_sms_messages_type"),
        sa.CheckConstraint(
            "status IN ('pending','recorded','ignored')", name="ck_sms_messages_status"
        ),
    )
    op.create_index("ix_sms_messages_family_id", "sms_messages", ["family_id"])
    op.create_index("ix_sms_messages_status", "sms_messages", ["status"])

    # ── otp_codes ─────────────────────────────────────────────
    op.create_table(
        "otp_codes",
        _uuid_pk(),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_otp_codes"),
    )
    op.create_index("ix_otp_codes_phone", "otp_codes", ["phone"])

    # ── sessions (token = هش SHA-256؛ رفع D-3) ────────────────
    op.create_table(
        "sessions",
        _uuid_pk(),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_sessions_member_id_members", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token", name="uq_sessions_token"),
    )
    op.create_index("ix_sessions_member_id", "sessions", ["member_id"])

    # ── auth_attempts ─────────────────────────────────────────
    op.create_table(
        "auth_attempts",
        _uuid_pk(),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_auth_attempts"),
    )
    op.create_index("ix_auth_attempts_phone_created_at", "auth_attempts", ["phone", "created_at"])

    # ── lookup_attempts (bigserial) ───────────────────────────
    op.create_table(
        "lookup_attempts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_lookup_attempts"),
    )
    op.create_index(
        "ix_lookup_attempts_kind_created_at",
        "lookup_attempts",
        ["kind", sa.text("created_at DESC")],
    )

    # ── family_invites ────────────────────────────────────────
    op.create_table(
        "family_invites",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_family_invites"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_family_invites_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["members.id"],
            name="fk_family_invites_created_by_members", ondelete="SET NULL",
        ),
        sa.UniqueConstraint("token", name="uq_family_invites_token"),
    )
    op.create_index("ix_family_invites_family_id", "family_invites", ["family_id"])

    # ── app_settings (تک‌ردیفی id=1) ──────────────────────────
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), autoincrement=False, server_default=sa.text("1"), nullable=False),
        sa.Column("dev_mode", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("otp_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_app_settings"),
        sa.CheckConstraint("id = 1", name="ck_app_settings_singleton"),
    )

    # ── custom_categories ─────────────────────────────────────
    op.create_table(
        "custom_categories",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_custom_categories"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_custom_categories_family_id_families", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("family_id", "type", "name", name="family_type_name"),
        sa.CheckConstraint("type IN ('expense','income')", name="ck_custom_categories_type"),
    )

    # ── category_budgets ──────────────────────────────────────
    op.create_table(
        "category_budgets",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_category_budgets"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_category_budgets_family_id_families", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("family_id", "category", name="family_category"),
        sa.CheckConstraint("amount > 0", name="ck_category_budgets_amount_positive"),
    )
    op.create_index("ix_category_budgets_family_id", "category_budgets", ["family_id"])

    # ── sms_bridges ───────────────────────────────────────────
    op.create_table(
        "sms_bridges",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_sms_bridges"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_sms_bridges_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_sms_bridges_member_id_members", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token", name="uq_sms_bridges_token"),
    )
    op.create_index("ix_sms_bridges_family_id", "sms_bridges", ["family_id"])

    # ── family_events ─────────────────────────────────────────
    op.create_table(
        "family_events",
        _uuid_pk(),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("for_member_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_family_events"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"],
            name="fk_family_events_family_id_families", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"],
            name="fk_family_events_member_id_members", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["for_member_id"], ["members.id"],
            name="fk_family_events_for_member_id_members", ondelete="SET NULL",
        ),
    )
    op.create_index("ix_family_events_family_id", "family_events", ["family_id"])


def downgrade() -> None:
    # ترتیب معکوس وابستگی‌ها (ایندکس‌ها با drop جدول در PG خودکار حذف می‌شوند)
    op.drop_table("family_events")
    op.drop_table("sms_bridges")
    op.drop_table("category_budgets")
    op.drop_table("custom_categories")
    op.drop_table("app_settings")
    op.drop_table("family_invites")
    op.drop_table("lookup_attempts")
    op.drop_table("auth_attempts")
    op.drop_table("sessions")
    op.drop_table("otp_codes")
    op.drop_table("sms_messages")
    op.drop_table("transaction_photos")
    op.drop_table("transactions")
    op.drop_table("subcategories")
    op.drop_table("card_bins")
    op.drop_table("accounts")
    op.drop_table("members")
    op.drop_table("families")
