"""Shared household tasks with RLS, completion integrity and revision protection.

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column(
            "assignee_id", UUID(as_uuid=True), sa.ForeignKey("members.id", ondelete="SET NULL")
        ),
        sa.Column("due_date", sa.Date()),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "completed_by", UUID(as_uuid=True), sa.ForeignKey("members.id", ondelete="SET NULL")
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
        sa.CheckConstraint("revision >= 1", name="task_revision_positive"),
        sa.CheckConstraint(
            "(completed AND completed_at IS NOT NULL) OR "
            "(NOT completed AND completed_at IS NULL AND completed_by IS NULL)",
            name="task_completion_consistent",
        ),
    )
    op.create_index("ix_tasks_family_id", "tasks", ["family_id"])
    op.create_index(
        "ix_tasks_family_completed_due", "tasks", ["family_id", "completed", "due_date"]
    )
    op.execute("ALTER TABLE tasks ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tasks FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tasks_family_isolation ON tasks FOR ALL USING ({_PREDICATE}) "
        f"WITH CHECK ({_PREDICATE})"
    )
    op.execute("""
        CREATE FUNCTION task_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER tasks_revision BEFORE UPDATE ON tasks "
        "FOR EACH ROW EXECUTE FUNCTION task_bump_revision()"
    )


def downgrade() -> None:
    op.drop_table("tasks")
    op.execute("DROP FUNCTION task_bump_revision()")
