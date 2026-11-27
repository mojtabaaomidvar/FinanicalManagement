"""Link household inventory rows to stable reviewed catalog identities."""

import sqlalchemy as sa

from alembic import op


revision = "0042_meal_inventory_links"
down_revision = "0041_household_changes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_items", sa.Column("catalog_id", sa.Text(), nullable=True))
    op.execute("ALTER TABLE meal_entries DROP CONSTRAINT ck_meal_entries_meal_entry_type_valid")
    op.create_check_constraint(op.f("ck_meal_entries_meal_entry_type_valid"), "meal_entries",
                               "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')")


def downgrade() -> None:
    # Do not silently discard snack slots during a rollback.
    op.execute("ALTER TABLE meal_entries DROP CONSTRAINT ck_meal_entries_meal_entry_type_valid")
    op.create_check_constraint(op.f("ck_meal_entries_meal_entry_type_valid"), "meal_entries",
                               "meal_type IN ('breakfast', 'lunch', 'dinner')")
    op.drop_column("inventory_items", "catalog_id")
