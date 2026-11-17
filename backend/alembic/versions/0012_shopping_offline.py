"""Offline shopping revisions and atomic idempotency receipts.

Database triggers cover online clients and checkout as well as offline writes.
A child mutation changes its parent once, protecting deletion of a stale list.
Receipts store server-side family/member scope, a request hash and acknowledgment;
they contain no queued content, prices, financial linkage, names or phone numbers.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("shopping_lists", "shopping_items", "inventory_items")
_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table, sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1"))
        )
    op.execute("""
        CREATE FUNCTION shopping_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.revision := OLD.revision + 1;
            RETURN NEW;
        END;
        $$
    """)
    for table in _TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_revision BEFORE UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION shopping_bump_revision()"
        )
    op.execute("""
        CREATE FUNCTION shopping_touch_parent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                UPDATE shopping_lists SET revision = revision + 1
                WHERE id = OLD.list_id AND family_id = OLD.family_id;
                RETURN OLD;
            END IF;
            UPDATE shopping_lists SET revision = revision + 1
            WHERE id = NEW.list_id AND family_id = NEW.family_id;
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER shopping_items_parent_revision "
        "AFTER INSERT OR UPDATE OR DELETE ON shopping_items "
        "FOR EACH ROW EXECUTE FUNCTION shopping_touch_parent()"
    )
    op.create_table(
        "shopping_sync_receipts",
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "member_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("operation_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.execute("ALTER TABLE shopping_sync_receipts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shopping_sync_receipts FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY shopping_sync_receipts_family_isolation "
        f"ON shopping_sync_receipts FOR ALL USING ({_PREDICATE}) "
        f"WITH CHECK ({_PREDICATE})"
    )


def downgrade() -> None:
    op.drop_table("shopping_sync_receipts")
    op.execute("DROP TRIGGER shopping_items_parent_revision ON shopping_items")
    op.execute("DROP FUNCTION shopping_touch_parent()")
    for table in _TABLES:
        op.execute(f"DROP TRIGGER {table}_revision ON {table}")
        op.drop_column(table, "revision")
    op.execute("DROP FUNCTION shopping_bump_revision()")
