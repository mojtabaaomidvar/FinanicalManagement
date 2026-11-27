"""Publish reviewed catalog additions without changing household inventory."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0040_inventory_catalog"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_catalog_proposals", sa.Column("published_at", sa.DateTime(timezone=True)))
    op.create_table(
        "inventory_catalog_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name_key", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text()),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 120", name="catalog_entry_title_length"),
        sa.CheckConstraint("unit IS NULL OR length(unit) BETWEEN 1 AND 20", name="catalog_entry_unit_length"),
    )
    # Existing approvals explicitly awaited a further review/release. Do not
    # retroactively publish them or touch inventory revisions/outbox receipts.


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM inventory_catalog_entries) OR "
                                  "EXISTS (SELECT 1 FROM inventory_catalog_proposals WHERE published_at IS NOT NULL)")).scalar_one():
        raise RuntimeError("Published catalog entries must be preserved; downgrade is not supported.")
    op.drop_table("inventory_catalog_entries")
    op.drop_column("inventory_catalog_proposals", "published_at")
