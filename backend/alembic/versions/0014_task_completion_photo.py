"""Optional completion photo, stored through the existing signed file service.

Revision ID: 0014
Revises: 0013
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("completion_photo_url", sa.Text(), nullable=True))
    op.create_check_constraint(
        "task_completion_photo_consistent",
        "tasks",
        "completed OR completion_photo_url IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint("task_completion_photo_consistent", "tasks", type_="check")
    op.drop_column("tasks", "completion_photo_url")
