"""Linked transfer fees and one-rial account balance precision."""
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE accounts ALTER COLUMN initial_balance TYPE numeric(19,1)")
    op.execute("""
        ALTER TABLE transactions
          ADD COLUMN transfer_fee_method text,
          ADD COLUMN transfer_fee_rial bigint,
          ADD COLUMN transfer_fee_for_id uuid,
          DROP CONSTRAINT ck_transactions_transaction_source_kind,
          DROP CONSTRAINT ck_transactions_transaction_source_shape,
          ADD CONSTRAINT ck_transactions_transaction_source_kind
            CHECK (source_kind IS NULL OR source_kind IN ('vehicle_service','transfer_fee')),
          ADD CONSTRAINT ck_transactions_transaction_source_shape CHECK (
            source_kind IS NULL OR (source_kind='vehicle_service' AND type='expense'
              AND category='transport' AND repeat='none' AND repeat_end IS NULL)
            OR (source_kind='transfer_fee' AND type='expense' AND category='finance'
              AND repeat='none' AND repeat_end IS NULL AND transfer_fee_for_id IS NOT NULL)),
          ADD CONSTRAINT ck_transfer_fee_parent CHECK (
            (transfer_fee_method IS NULL AND transfer_fee_rial IS NULL) OR
            (type='transfer' AND transfer_fee_method IS NOT NULL AND transfer_fee_method IN ('internal','card_to_card','paya','satna','pol')
              AND transfer_fee_rial IS NOT NULL AND transfer_fee_rial >= 0)),
          ADD CONSTRAINT ck_transfer_fee_origin CHECK (
            (source_kind IS NOT NULL AND source_kind='transfer_fee' AND transfer_fee_for_id IS NOT NULL) OR
            (source_kind IS DISTINCT FROM 'transfer_fee' AND transfer_fee_for_id IS NULL)),
          ADD CONSTRAINT fk_transfer_fee_family FOREIGN KEY (transfer_fee_for_id,family_id)
            REFERENCES transactions (id,family_id) ON DELETE CASCADE,
          ADD CONSTRAINT uq_transfer_fee UNIQUE (transfer_fee_for_id)
    """)
    access = """source_kind IS DISTINCT FROM 'vehicle_service' OR EXISTS (
        SELECT 1 FROM members m
        WHERE m.id = NULLIF(current_setting('app.document_member_id',true),'')::uuid
          AND m.family_id=transactions.family_id AND m.status='active' AND m.membership_state='active'
          AND (m.document_access_not_before IS NULL OR m.document_access_not_before <=
               (now() AT TIME ZONE 'Asia/Tehran')::date)
          AND ((m.birth_date IS NOT NULL AND m.birth_date <=
                ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date)
               OR (m.birth_date IS NULL AND m.relation <> 'فرزند')))"""
    op.execute(f"ALTER POLICY transactions_vehicle_service_age ON transactions USING ({access}) WITH CHECK ({access})")


def downgrade() -> None:
    raise RuntimeError("Keep rial precision and linked financial history; restore only from a verified backup.")
