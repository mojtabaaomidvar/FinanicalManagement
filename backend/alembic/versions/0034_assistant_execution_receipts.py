"""Member/family scoped receipts for explicitly confirmed assistant actions."""
from alembic import op

revision = "0034_assistant_receipts"
down_revision = "0033_inventory_categories"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE assistant_execution_receipts (
            family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            operation_id uuid NOT NULL,
            request_hash text NOT NULL CHECK (length(request_hash) = 64),
            result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (family_id, member_id, operation_id)
        );
        ALTER TABLE assistant_execution_receipts ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assistant_execution_receipts FORCE ROW LEVEL SECURITY;
        CREATE POLICY assistant_execution_scope ON assistant_execution_receipts FOR ALL
          USING (
            family_id = NULLIF(current_setting('app.family_id', true), '')::uuid AND
            member_id = NULLIF(current_setting('app.document_member_id', true), '')::uuid
          )
          WITH CHECK (
            family_id = NULLIF(current_setting('app.family_id', true), '')::uuid AND
            member_id = NULLIF(current_setting('app.document_member_id', true), '')::uuid
          );
    """)


def downgrade():
    op.execute("DROP TABLE assistant_execution_receipts")
