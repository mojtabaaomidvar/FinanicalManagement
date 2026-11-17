"""Shared weekly meals and durable results for the shopping batch command.

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def _shared_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by", UUID(as_uuid=True), sa.ForeignKey("members.id", ondelete="SET NULL")
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "meal_dishes",
        *_shared_columns(),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("ingredients", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.UniqueConstraint("id", "family_id", name="uq_meal_dishes_id_family"),
        sa.CheckConstraint("revision >= 1", name="meal_dish_revision_positive"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="meal_dish_title_length"),
        sa.CheckConstraint(
            "jsonb_typeof(ingredients) = 'array' AND jsonb_array_length(ingredients) <= 50",
            name="meal_dish_ingredients_array",
        ),
    )
    op.create_table(
        "meal_entries",
        *_shared_columns(),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("meal_type", sa.Text(), nullable=False),
        sa.Column("dish_id", UUID(as_uuid=True), nullable=False),
        # NO ACTION restricts dish deletion and still lets a family's two
        # CASCADE branches finish in the same statement.
        sa.ForeignKeyConstraint(
            ["dish_id", "family_id"],
            ["meal_dishes.id", "meal_dishes.family_id"],
            ondelete="NO ACTION",
            name="fk_meal_entry_dish_family",
        ),
        sa.UniqueConstraint("family_id", "date", "meal_type", name="uq_meal_entries_family_slot"),
        sa.CheckConstraint("revision >= 1", name="meal_entry_revision_positive"),
        sa.CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner')", name="meal_entry_type_valid"
        ),
    )
    op.create_index("ix_meal_entries_family_date", "meal_entries", ["family_id", "date"])
    op.create_index("ix_meal_entries_dish_family", "meal_entries", ["dish_id", "family_id"])
    op.execute("""
        CREATE FUNCTION meal_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    for table in ("meal_dishes", "meal_entries"):
        op.create_index(f"ix_{table}_family_id", table, ["family_id"])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_family_isolation ON {table} FOR ALL "
            f"USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
        )
        op.execute(
            f"CREATE TRIGGER {table}_revision BEFORE UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION meal_bump_revision()"
        )
    op.add_column("shopping_sync_receipts", sa.Column("result_json", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("shopping_sync_receipts", "result_json")
    op.drop_table("meal_entries")
    op.drop_table("meal_dishes")
    op.execute("DROP FUNCTION meal_bump_revision()")
