"""Short-lived AI daily allowances and shared concurrency leases."""

import sqlalchemy as sa

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_daily_allowances",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("scope", sa.Text(), primary_key=True),
        sa.Column("requests", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("requests > 0", name="ai_allowance_positive"),
    )
    op.create_table(
        "ai_capacity_leases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_capacity_leases_expires_at", "ai_capacity_leases", ["expires_at"])


def downgrade() -> None:
    op.drop_table("ai_capacity_leases")
    op.drop_table("ai_daily_allowances")
