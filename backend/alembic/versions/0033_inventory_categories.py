"""Persistent stock categories, anonymous catalog review; remove shortage thresholds.

Threshold deletion is irreversible and explicitly approved. Quantities, notes,
household isolation and all historical sync receipts remain intact.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0033_inventory_categories"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_items", sa.Column("category", sa.Text(), nullable=True))
    op.drop_constraint(op.f("ck_inventory_items_threshold_not_negative"), "inventory_items", type_="check")
    op.drop_column("inventory_items", "threshold")
    # The migration's table lock keeps this temporary owner-only backfill atomic.
    # Restore FORCE RLS before releasing the transaction/lock to application traffic.
    op.execute("ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY")
    from app.services.inventory_catalog import infer_category
    connection = op.get_bind()
    # This is metadata backfill, not a new user edit. Preserve the revisions
    # expected by historical queued writes; restore the exact trigger before commit.
    revision_trigger = connection.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_trigger "
        "WHERE tgrelid='inventory_items'::regclass "
        "AND tgname='inventory_items_revision' AND NOT tgisinternal)"
    )).scalar_one()
    if revision_trigger:
        op.execute("ALTER TABLE inventory_items DISABLE TRIGGER inventory_items_revision")
    rows = connection.execute(sa.text("SELECT id, title FROM inventory_items")).all()
    for row in rows:
        category = infer_category(row.title)
        if category is not None:
            connection.execute(sa.text("UPDATE inventory_items SET category=:category WHERE id=:id"),
                               {"category": category, "id": row.id})
    if revision_trigger:
        op.execute("ALTER TABLE inventory_items ENABLE TRIGGER inventory_items_revision")
    op.execute("ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY")
    op.create_table("inventory_catalog_proposals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("submission_key", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="catalog_proposal_status"),
    )
    # Deliberately global, like support counters: no tenant/member columns or FK.
    op.create_index("ix_catalog_proposal_queue", "inventory_catalog_proposals", ["status", "submitted_at"])


def downgrade() -> None:
    raise RuntimeError("Deleted threshold values cannot be recovered; downgrade is not supported.")
