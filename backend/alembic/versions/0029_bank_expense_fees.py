"""Allow the existing linked banking fee on expense parents without changing records."""
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE transactions DROP CONSTRAINT ck_transfer_fee_parent,
          ADD CONSTRAINT ck_transfer_fee_parent CHECK (
            (transfer_fee_method IS NULL AND transfer_fee_rial IS NULL) OR
            (type IN ('expense','transfer') AND transfer_fee_method IS NOT NULL
              AND transfer_fee_method IN ('internal','card_to_card','paya','satna','pol')
              AND transfer_fee_rial IS NOT NULL AND transfer_fee_rial >= 0))
    """)


def downgrade() -> None:
    raise RuntimeError("Preserve linked payment fees; restore only from a verified backup.")
