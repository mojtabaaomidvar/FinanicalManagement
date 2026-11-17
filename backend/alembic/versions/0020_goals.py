"""Owner-private encrypted goals and wishes, including active children.

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MEMBER = "NULLIF(current_setting('app.document_member_id', true), '')::uuid"
_FAMILY = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_ACCESS = f"""{_FAMILY} AND owner_id = {_MEMBER} AND EXISTS (
    SELECT 1 FROM members m WHERE m.id = {_MEMBER} AND m.family_id = goals.family_id
    AND m.status = 'active' AND m.membership_state = 'active')"""  # noqa: S608 -- module-owned SQL constants.


def upgrade() -> None:
    op.create_unique_constraint("uq_members_id_family", "members", ["id", "family_id"])
    op.create_table(
        "goals",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
        sa.Column("encrypted_content", sa.LargeBinary(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default=sa.text("'goal'")),
        sa.Column("target_date", sa.Date()),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["owner_id", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_goal_owner_family",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("kind IN ('goal','wish')", name="goal_kind"),
        sa.CheckConstraint("status IN ('active','done')", name="goal_status"),
        sa.CheckConstraint("revision >= 1", name="goal_revision_positive"),
        sa.CheckConstraint("octet_length(encrypted_content) >= 35", name="goal_content_envelope"),
    )
    op.create_index("ix_goals_family_id", "goals", ["family_id"])
    op.create_index("ix_goals_owner_id", "goals", ["owner_id"])
    op.create_index("ix_goals_owner_target", "goals", ["owner_id", "target_date"])
    op.execute("ALTER TABLE goals ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE goals FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY goals_family_isolation ON goals FOR ALL "
        f"USING ({_ACCESS}) WITH CHECK ({_ACCESS})"
    )
    op.execute("""
        CREATE FUNCTION goal_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.family_id IS DISTINCT FROM OLD.family_id OR
               NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
                RAISE EXCEPTION 'Goal ownership is immutable' USING ERRCODE = '42501';
            END IF;
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER goals_revision BEFORE UPDATE ON goals "
        "FOR EACH ROW EXECUTE FUNCTION goal_before_update()"
    )


def downgrade() -> None:
    op.drop_table("goals")
    op.execute("DROP FUNCTION goal_before_update()")
    op.drop_constraint("uq_members_id_family", "members", type_="unique")
