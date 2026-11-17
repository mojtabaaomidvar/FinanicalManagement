"""Preserve document eligibility independently of self-edited profile dates.

Revision ID: 0016
Revises: 0015
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREDICATE = """family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND (visibility = 'shared' OR owner_id =
         NULLIF(current_setting('app.document_member_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM members m
        WHERE m.id = NULLIF(current_setting('app.document_member_id', true), '')::uuid
          AND m.family_id = documents.family_id
          AND m.status = 'active' AND m.membership_state = 'active'
          AND (m.document_access_not_before IS NULL OR
               m.document_access_not_before <= (now() AT TIME ZONE 'Asia/Tehran')::date)
          AND ((m.birth_date IS NOT NULL AND m.birth_date <=
                ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date)
               OR (m.birth_date IS NULL AND m.relation <> 'فرزند')))
"""


def upgrade() -> None:
    op.add_column("members", sa.Column("document_access_not_before", sa.Date(), nullable=True))
    op.execute("""
        UPDATE members SET document_access_not_before = CASE
            WHEN birth_date IS NOT NULL AND birth_date >
                ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date
                THEN LEAST(birth_date + interval '18 years', date '9999-12-31')::date
            WHEN birth_date IS NULL AND relation = 'فرزند' THEN date '9999-12-31'
            ELSE NULL END
    """)
    op.execute("""
        CREATE FUNCTION member_document_age_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.birth_date IS NOT NULL AND NEW.birth_date >
                ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date THEN
                NEW.document_access_not_before :=
                    LEAST(NEW.birth_date + interval '18 years', date '9999-12-31')::date;
            ELSIF NEW.birth_date IS NULL AND NEW.relation = 'فرزند' THEN
                NEW.document_access_not_before := date '9999-12-31';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER members_document_age BEFORE INSERT ON members "
        "FOR EACH ROW EXECUTE FUNCTION member_document_age_on_insert()"
    )
    op.execute(
        "ALTER POLICY documents_family_isolation ON documents "
        f"USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER members_document_age ON members")
    op.execute("DROP FUNCTION member_document_age_on_insert()")
    previous = _PREDICATE.replace(
        "          AND (m.document_access_not_before IS NULL OR\n"
        "               m.document_access_not_before <= "
        "(now() AT TIME ZONE 'Asia/Tehran')::date)\n",
        "",
    )
    op.execute(
        "ALTER POLICY documents_family_isolation ON documents "
        f"USING ({previous}) WITH CHECK ({previous})"
    )
    op.drop_column("members", "document_access_not_before")
