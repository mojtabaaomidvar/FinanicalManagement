"""Own-member Home arrangement, separate from notification and profile preferences.

Revision ID: 0024
Revises: 0023
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("members", sa.Column("home_preferences", JSONB(), nullable=True))
    op.add_column(
        "members",
        sa.Column(
            "home_preferences_revision", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.create_check_constraint(
        "home_preferences_revision_nonnegative",
        "members",
        "home_preferences_revision >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_members_home_preferences_revision_nonnegative"), "members", type_="check"
    )
    op.drop_column("members", "home_preferences_revision")
    op.drop_column("members", "home_preferences")
