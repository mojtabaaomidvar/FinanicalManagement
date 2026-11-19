"""Independent support references, operator sessions and anonymous counters."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("members", sa.Column("support_code", postgresql.UUID(as_uuid=True),
                  server_default=sa.text("gen_random_uuid()"), nullable=False))
    op.create_unique_constraint("uq_members_support_code", "members", ["support_code"])
    op.create_table("support_sessions",
        sa.Column("token_hash", sa.Text(), primary_key=True),
        sa.Column("credential_tag", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_support_sessions_expires_at", "support_sessions", ["expires_at"])
    op.create_table("support_error_counters",
        sa.Column("hour", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("kind", sa.Text(), primary_key=True),
        sa.Column("http_family", sa.Text(), primary_key=True),
        sa.Column("count", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("kind IN ('login','registration')", name="support_error_kind"),
        sa.CheckConstraint("http_family IN ('client','server')", name="support_error_http_family"),
        sa.CheckConstraint("count > 0", name="support_error_count_positive"))


def downgrade() -> None:
    op.drop_table("support_error_counters")
    op.drop_table("support_sessions")
    op.drop_constraint("uq_members_support_code", "members", type_="unique")
    op.drop_column("members", "support_code")
