"""Aggregate AI request and provider usage counters without identities."""

import sqlalchemy as sa

from alembic import context, op

revision = "0038"
down_revision = "0037_wallet_corrections"
branch_labels = None
depends_on = None


STAGES = ("sms", "assistant_analyze", "assistant_plan", "assistant_report")


def upgrade() -> None:
    if not context.is_offline_mode():
        privileged = op.get_bind().execute(sa.text(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )).scalar_one()
        if not privileged:
            raise RuntimeError("AI usage migration requires the database migration administrator.")
    op.create_table(
        "support_ai_counters",
        sa.Column("hour", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("stage", sa.Text(), primary_key=True),
        sa.Column("status", sa.Text(), primary_key=True),
        sa.Column("requests", sa.BigInteger(), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("input_token_requests", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_token_requests", sa.BigInteger(), nullable=False, server_default="0"),
        sa.CheckConstraint(
            "stage IN (" + ",".join(repr(stage) for stage in STAGES) + ")", name="support_ai_stage",
        ),
        sa.CheckConstraint("status IN ('success','failure')", name="support_ai_status"),
        sa.CheckConstraint("requests > 0", name="support_ai_requests_positive"),
        sa.CheckConstraint("input_tokens >= 0", name="support_ai_input_tokens_nonnegative"),
        sa.CheckConstraint("output_tokens >= 0", name="support_ai_output_tokens_nonnegative"),
        sa.CheckConstraint(
            "input_token_requests >= 0 AND input_token_requests <= requests",
            name="support_ai_input_requests_valid",
        ),
        sa.CheckConstraint(
            "output_token_requests >= 0 AND output_token_requests <= requests",
            name="support_ai_output_requests_valid",
        ),
    )


def downgrade() -> None:
    op.drop_table("support_ai_counters")
