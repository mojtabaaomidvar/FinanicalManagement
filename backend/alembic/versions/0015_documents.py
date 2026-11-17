"""Encrypted documents, private-owner isolation and active adult authorization.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MEMBER = "NULLIF(current_setting('app.document_member_id', true), '')::uuid"
_FAMILY = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_ACTIVE = f"""EXISTS (SELECT 1 FROM members m WHERE m.id = {_MEMBER}
    AND m.family_id = documents.family_id AND m.status = 'active'
    AND m.membership_state = 'active'
    AND ((m.birth_date IS NOT NULL AND m.birth_date <=
          ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date)
         OR (m.birth_date IS NULL AND m.relation <> 'فرزند')))
"""  # noqa: S608 -- SQL contains only module-owned constants.
_READ = f"{_FAMILY} AND {_ACTIVE} AND (visibility = 'shared' OR owner_id = {_MEMBER})"
_MODIFY = f"""{_READ} AND (owner_id = {_MEMBER} OR
    (visibility = 'shared' AND EXISTS (SELECT 1 FROM members m WHERE m.id = {_MEMBER}
     AND m.role IN ('owner','admin'))))"""  # noqa: S608 -- SQL contains only constants.


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("encrypted_metadata", sa.LargeBinary(), nullable=False),
        sa.Column("visibility", sa.Text(), nullable=False, server_default=sa.text("'private'")),
        sa.Column("expiry_date", sa.Date()),
        sa.Column("reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("visibility IN ('private','shared')", name="document_visibility"),
        sa.CheckConstraint("revision >= 1", name="document_revision_positive"),
        sa.CheckConstraint("file_size > 0 AND file_size <= 10485760", name="document_file_size"),
    )
    op.create_index("ix_documents_family_id", "documents", ["family_id"])
    op.create_index("ix_documents_owner_id", "documents", ["owner_id"])
    op.create_index("ix_documents_family_expiry", "documents", ["family_id", "expiry_date"])
    op.execute("ALTER TABLE documents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE documents FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY documents_family_isolation ON documents FOR ALL "
        f"USING ({_READ}) WITH CHECK ({_READ})"
    )
    op.execute(
        "CREATE POLICY documents_insert_owner ON documents AS RESTRICTIVE FOR INSERT "
        f"WITH CHECK (owner_id = {_MEMBER})"
    )
    op.execute(
        "CREATE POLICY documents_update_owner_or_admin ON documents AS RESTRICTIVE "
        f"FOR UPDATE USING ({_MODIFY}) WITH CHECK ({_MODIFY})"
    )
    op.execute(
        "CREATE POLICY documents_delete_owner_or_admin ON documents AS RESTRICTIVE "
        f"FOR DELETE USING ({_MODIFY})"
    )
    op.execute(f"""
        CREATE FUNCTION document_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.family_id <> OLD.family_id OR NEW.owner_id <> OLD.owner_id THEN
                RAISE EXCEPTION 'Document ownership is immutable' USING ERRCODE = '42501';
            END IF;
            IF NEW.visibility <> OLD.visibility AND OLD.owner_id <> {_MEMBER} THEN
                RAISE EXCEPTION 'Only the document owner can change visibility'
                    USING ERRCODE = '42501';
            END IF;
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER documents_revision BEFORE UPDATE ON documents "
        "FOR EACH ROW EXECUTE FUNCTION document_before_update()"
    )


def downgrade() -> None:
    op.drop_table("documents")
    op.execute("DROP FUNCTION document_before_update()")
