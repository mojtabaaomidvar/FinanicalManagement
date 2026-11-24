"""Add SMS provenance and atomic transaction links without rewriting history."""
from alembic import op

revision = "0035_sms_integrity"
down_revision = "0034_assistant_receipts"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE sms_messages
          ADD COLUMN time text,
          ADD COLUMN received_at timestamptz,
          ADD COLUMN transport_id text,
          ADD COLUMN identity_key text,
          ADD COLUMN parser_version text,
          ADD COLUMN transaction_id uuid;
        ALTER TABLE sms_messages ADD CONSTRAINT sms_transaction_family
          FOREIGN KEY (transaction_id, family_id) REFERENCES transactions(id, family_id)
          ON DELETE SET NULL (transaction_id);
        CREATE UNIQUE INDEX sms_identity_unique ON sms_messages(family_id, member_id, identity_key)
          WHERE identity_key IS NOT NULL;
        CREATE UNIQUE INDEX sms_transaction_unique ON sms_messages(transaction_id)
          WHERE transaction_id IS NOT NULL;
        ALTER TABLE sms_messages ADD CONSTRAINT sms_link_recorded
          CHECK (transaction_id IS NULL OR status = 'recorded');
    """)


def downgrade():
    op.execute("""
        ALTER TABLE sms_messages DROP CONSTRAINT sms_link_recorded;
        DROP INDEX sms_transaction_unique;
        DROP INDEX sms_identity_unique;
        ALTER TABLE sms_messages DROP CONSTRAINT sms_transaction_family;
        ALTER TABLE sms_messages DROP COLUMN transaction_id, DROP COLUMN parser_version,
          DROP COLUMN identity_key, DROP COLUMN transport_id, DROP COLUMN received_at, DROP COLUMN time;
    """)
