"""Remember explicit payment methods without rewriting financial history."""
from alembic import op

revision = "0036_payment_method"
down_revision = "0035_sms_integrity"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE transactions ADD COLUMN payment_method text;
        ALTER TABLE transactions ADD CONSTRAINT transaction_payment_method
          CHECK (payment_method IS NULL OR
            (type='expense' AND payment_method IN ('card','online','bank_transfer')));
        ALTER TABLE transactions ADD CONSTRAINT transaction_payment_fee
          CHECK (payment_method IS NULL OR payment_method='bank_transfer' OR transfer_fee_method IS NULL);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE transactions DROP CONSTRAINT transaction_payment_fee;
        ALTER TABLE transactions DROP CONSTRAINT transaction_payment_method;
        ALTER TABLE transactions DROP COLUMN payment_method;
    """)
