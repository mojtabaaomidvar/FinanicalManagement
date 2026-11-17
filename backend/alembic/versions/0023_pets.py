"""Pets with manager RLS and server-managed canonical care tasks.

Revision ID: 0023
Revises: 0022
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MEMBER = "NULLIF(current_setting('app.document_member_id', true), '')::uuid"
_FAMILY = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_ACTIVE = f"""EXISTS (SELECT 1 FROM members m WHERE m.id={_MEMBER}
    AND m.family_id=pets.family_id AND m.status='active'
    AND m.membership_state='active')"""  # noqa: S608 -- module-owned SQL constants.
_MANAGER = f"""EXISTS (SELECT 1 FROM members m WHERE m.id={_MEMBER}
    AND m.family_id=pets.family_id AND m.status='active'
    AND m.membership_state='active' AND m.role IN ('owner','admin'))"""  # noqa: S608


def upgrade() -> None:
    op.create_table(
        "pets",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("species", sa.Text(), nullable=False),
        sa.Column("breed", sa.Text()),
        sa.Column("birth_date", sa.Date()),
        sa.Column("created_by", UUID(as_uuid=True)),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "family_id", name="uq_pets_id_family"),
        sa.CheckConstraint("revision >= 1", name="pet_revision_positive"),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 80", name="pet_name_length"),
        sa.CheckConstraint("char_length(species) BETWEEN 1 AND 60", name="pet_species_length"),
        sa.CheckConstraint("breed IS NULL OR char_length(breed) <= 100", name="pet_breed_length"),
    )
    op.create_index("ix_pets_family_id", "pets", ["family_id"])
    op.execute(
        "ALTER TABLE pets ADD CONSTRAINT fk_pet_creator_family "
        "FOREIGN KEY (created_by,family_id) REFERENCES members (id,family_id) "
        "ON DELETE SET NULL (created_by)"
    )
    op.execute("ALTER TABLE pets ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE pets FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY pets_family_isolation ON pets FOR ALL "
        f"USING ({_FAMILY}) WITH CHECK ({_FAMILY})"
    )
    for action, expression in (
        ("SELECT", _ACTIVE),
        ("INSERT", f"({_MANAGER}) AND created_by={_MEMBER}"),
        ("UPDATE", _MANAGER),
        ("DELETE", _MANAGER),
    ):
        using = "" if action == "INSERT" else f"USING ({expression})"
        check = f"WITH CHECK ({expression})" if action in {"INSERT", "UPDATE"} else ""
        op.execute(
            f"CREATE POLICY pets_{action.lower()} ON pets AS RESTRICTIVE "
            f"FOR {action} {using} {check}"
        )
    op.execute("""
        CREATE FUNCTION pet_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.family_id IS DISTINCT FROM OLD.family_id THEN
                RAISE EXCEPTION 'Pet family is immutable' USING ERRCODE='42501';
            END IF;
            IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
                IF NEW.created_by IS NOT NULL OR OLD.created_by IS NULL OR
                   EXISTS (SELECT 1 FROM members m WHERE m.id=OLD.created_by) THEN
                    RAISE EXCEPTION 'Pet creator is immutable' USING ERRCODE='42501';
                END IF;
            END IF;
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER pets_revision BEFORE UPDATE ON pets "
        "FOR EACH ROW EXECUTE FUNCTION pet_before_update()"
    )
    op.add_column("tasks", sa.Column("pet_id", UUID(as_uuid=True)))
    op.create_index("ix_tasks_pet_family", "tasks", ["pet_id", "family_id"])
    op.execute(
        "ALTER TABLE tasks ADD CONSTRAINT fk_task_pet_family "
        "FOREIGN KEY (pet_id,family_id) REFERENCES pets (id,family_id) "
        "ON DELETE SET NULL (pet_id)"
    )


def downgrade() -> None:
    op.drop_constraint("fk_task_pet_family", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_pet_family", table_name="tasks")
    op.drop_column("tasks", "pet_id")
    op.drop_table("pets")
    op.execute("DROP FUNCTION pet_before_update()")
