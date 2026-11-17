"""Version canonical member profiles for the Children projection.

Revision ID: 0022
Revises: 0021
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "members",
        sa.Column("profile_revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.create_check_constraint("profile_revision_positive", "members", "profile_revision >= 1")
    op.execute("""
        CREATE FUNCTION member_profile_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.profile_revision := OLD.profile_revision + 1;
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER members_profile_revision BEFORE UPDATE OF "
        "name,birth_date,relation,status,membership_state ON members "
        "FOR EACH ROW EXECUTE FUNCTION member_profile_before_update()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER members_profile_revision ON members")
    op.execute("DROP FUNCTION member_profile_before_update()")
    op.drop_constraint("ck_members_profile_revision_positive", "members", type_="check")
    op.drop_column("members", "profile_revision")
