"""Editable recurring plans and atomic, unique occurrence settlement."""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE transactions
          ADD COLUMN recurring_amount numeric(15,2),
          ADD COLUMN recurring_category text,
          ADD COLUMN recurring_note text,
          ADD COLUMN recurring_start_date date,
          ADD COLUMN recurring_revision integer NOT NULL DEFAULT 0,
          ADD COLUMN recurring_source_id uuid,
          ADD COLUMN recurring_due_date date,
          ADD CONSTRAINT ck_recurring_amount
            CHECK (recurring_amount IS NULL OR recurring_amount > 0),
          ADD CONSTRAINT ck_recurring_revision CHECK (recurring_revision >= 0),
          ADD CONSTRAINT ck_recurring_origin
            CHECK ((recurring_source_id IS NULL) = (recurring_due_date IS NULL)),
          ADD CONSTRAINT fk_recurring_source_family FOREIGN KEY (recurring_source_id, family_id)
            REFERENCES transactions (id, family_id) ON DELETE RESTRICT,
          ADD CONSTRAINT uq_recurring_settlement
            UNIQUE (family_id, recurring_source_id, recurring_due_date)
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE transactions DROP CONSTRAINT uq_recurring_settlement,
          DROP CONSTRAINT fk_recurring_source_family, DROP CONSTRAINT ck_recurring_origin,
          DROP CONSTRAINT ck_recurring_revision, DROP CONSTRAINT ck_recurring_amount,
          DROP COLUMN recurring_due_date, DROP COLUMN recurring_source_id,
          DROP COLUMN recurring_revision, DROP COLUMN recurring_start_date,
          DROP COLUMN recurring_note, DROP COLUMN recurring_category, DROP COLUMN recurring_amount
    """)
