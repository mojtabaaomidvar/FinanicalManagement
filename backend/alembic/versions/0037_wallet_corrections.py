"""Add audited wallet corrections; no historical amounts are rewritten."""
from alembic import op

revision = "0037_wallet_corrections"
down_revision = "0036_payment_method"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
      ALTER TABLE accounts ADD COLUMN balance_revision bigint NOT NULL DEFAULT 0;
      ALTER TABLE transactions DROP CONSTRAINT ck_transactions_transaction_source_kind;
      ALTER TABLE transactions DROP CONSTRAINT ck_transactions_transaction_source_shape;
      ALTER TABLE transactions ADD CONSTRAINT ck_transactions_transaction_source_kind
        CHECK(source_kind IS NULL OR source_kind IN ('vehicle_service','transfer_fee','wallet_correction'));
      ALTER TABLE transactions ADD CONSTRAINT ck_transactions_transaction_source_shape CHECK (
        source_kind IS NULL OR (source_kind='vehicle_service' AND type='expense' AND category='transport'
        AND repeat='none' AND repeat_end IS NULL) OR (source_kind='transfer_fee' AND type='expense'
        AND category='finance' AND repeat='none' AND repeat_end IS NULL AND transfer_fee_for_id IS NOT NULL)
        OR (source_kind='wallet_correction' AND ((type='income' AND category='adjust-i') OR (type='expense' AND category='adjust-e'))
        AND repeat='none' AND repeat_end IS NULL AND account_id IS NOT NULL AND to_account_id IS NULL
        AND transfer_fee_method IS NULL AND payment_method IS NULL));
      CREATE TABLE wallet_corrections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        created_by uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
        operation_id uuid NOT NULL,
        request_hash text NOT NULL CONSTRAINT ck_wallet_corrections_wallet_correction_hash CHECK (length(request_hash)=64),
        mode text NOT NULL CONSTRAINT ck_wallet_corrections_wallet_correction_mode CHECK (mode IN ('ledger','reconciliation')),
        revision bigint NOT NULL CONSTRAINT ck_wallet_corrections_wallet_correction_revision CHECK(revision>0),
        target_balance numeric(28,2) NOT NULL,
        ledger_before numeric(28,2) NOT NULL,
        current_before numeric(28,2) NOT NULL,
        ledger_after numeric(28,2) NOT NULL,
        current_after numeric(28,2) NOT NULL,
        delta numeric(28,2) NOT NULL,
        description text CONSTRAINT ck_wallet_corrections_wallet_correction_description CHECK (length(description)<=200),
        transaction_id uuid UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_wallet_family_operation UNIQUE(family_id, operation_id),
        CONSTRAINT uq_wallet_account_revision UNIQUE(account_id, revision),
        CONSTRAINT fk_wallet_transaction_family FOREIGN KEY(transaction_id,family_id)
          REFERENCES transactions(id,family_id) ON DELETE RESTRICT,
        CONSTRAINT ck_wallet_corrections_wallet_correction_target CHECK (current_after=target_balance),
        CONSTRAINT ck_wallet_corrections_wallet_correction_delta CHECK (delta=target_balance-CASE WHEN mode='ledger' THEN ledger_before ELSE current_before END),
        CONSTRAINT ck_wallet_corrections_wallet_correction_shape CHECK ((mode='reconciliation' AND transaction_id IS NULL AND ledger_after=ledger_before)
            OR (mode='ledger' AND ledger_after=target_balance AND
                ((delta=0 AND transaction_id IS NULL) OR (delta<>0 AND transaction_id IS NOT NULL))))
      );
      ALTER TABLE wallet_corrections ENABLE ROW LEVEL SECURITY;
      ALTER TABLE wallet_corrections FORCE ROW LEVEL SECURITY;
      CREATE POLICY wallet_correction_read ON wallet_corrections FOR SELECT USING (
        family_id=nullif(current_setting('app.family_id',true),'')::uuid AND EXISTS(
          SELECT 1 FROM members viewer JOIN accounts a ON a.id=account_id AND a.family_id=viewer.family_id
          WHERE viewer.id=nullif(current_setting('app.document_member_id',true),'')::uuid
          AND viewer.family_id=wallet_corrections.family_id AND viewer.status='active' AND viewer.membership_state='active'
          AND (a.member_id=viewer.id OR viewer.role IN ('owner','admin'))));
      CREATE POLICY wallet_correction_create ON wallet_corrections FOR INSERT WITH CHECK (
        family_id=nullif(current_setting('app.family_id',true),'')::uuid
        AND created_by=nullif(current_setting('app.document_member_id',true),'')::uuid AND EXISTS(
          SELECT 1 FROM accounts a JOIN members creator ON creator.id=a.member_id
          WHERE a.id=account_id AND a.family_id=wallet_corrections.family_id
          AND a.member_id=created_by AND creator.status='active' AND creator.membership_state='active'));

      -- Amount-only projection: source-detail age rules must not remove money
      -- from the ledger. No SQL, family argument or transaction description is returned.
      CREATE FUNCTION public.wallet_ledger_balance(aid uuid, excluded uuid DEFAULT NULL)
        RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path=pg_catalog SET row_security=off AS $ledger$
        SELECT a.initial_balance + coalesce((SELECT sum(
          CASE WHEN t.account_id=a.id THEN CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END ELSE 0 END
          + CASE WHEN t.type='transfer' AND t.to_account_id=a.id THEN t.amount ELSE 0 END)
          FROM public.transactions t WHERE t.family_id=a.family_id
          AND (excluded IS NULL OR (t.id<>excluded AND t.transfer_fee_for_id IS DISTINCT FROM excluded))),0)
        FROM public.accounts a JOIN public.members viewer
          ON viewer.id=nullif(current_setting('app.document_member_id',true),'')::uuid
          AND viewer.family_id=a.family_id AND viewer.status='active' AND viewer.membership_state='active'
        WHERE a.id=aid AND a.family_id=nullif(current_setting('app.family_id',true),'')::uuid
          AND (a.member_id=viewer.id OR viewer.role IN ('owner','admin'))
        $ledger$;
      REVOKE ALL ON FUNCTION public.wallet_ledger_balance(uuid,uuid) FROM PUBLIC;

      -- Existence only: deletion cannot detach an age-protected transaction.
      CREATE FUNCTION public.wallet_account_has_transactions(aid uuid)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path=pg_catalog SET row_security=off AS $history$
        SELECT EXISTS(SELECT 1 FROM public.transactions t WHERE t.family_id=a.family_id
          AND (t.account_id=a.id OR t.to_account_id=a.id))
        FROM public.accounts a JOIN public.members viewer
          ON viewer.id=nullif(current_setting('app.document_member_id',true),'')::uuid
          AND viewer.family_id=a.family_id AND viewer.status='active' AND viewer.membership_state='active'
        WHERE a.id=aid AND a.family_id=nullif(current_setting('app.family_id',true),'')::uuid
          AND (a.member_id=viewer.id OR viewer.role IN ('owner','admin'))
        $history$;
      REVOKE ALL ON FUNCTION public.wallet_account_has_transactions(uuid) FROM PUBLIC;

      -- Statement-level acquisition precedes transaction row locks, including raw SQL.
      CREATE FUNCTION wallet_financial_statement_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE fid text := nullif(current_setting('app.family_id',true),'');
      BEGIN
        IF fid IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || fid,0)); END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER wallet_tx_statement BEFORE INSERT OR UPDATE OR DELETE ON transactions
        FOR EACH STATEMENT EXECUTE FUNCTION wallet_financial_statement_lock();
      CREATE TRIGGER wallet_account_statement BEFORE INSERT OR UPDATE OR DELETE ON accounts
        FOR EACH STATEMENT EXECUTE FUNCTION wallet_financial_statement_lock();
      CREATE TRIGGER wallet_receipt_statement BEFORE INSERT OR UPDATE OR DELETE ON wallet_corrections
        FOR EACH STATEMENT EXECUTE FUNCTION wallet_financial_statement_lock();

      CREATE FUNCTION wallet_transaction_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE ids uuid[] := '{}'; aid uuid;
      BEGIN
        IF TG_OP<>'INSERT' THEN ids := ids || ARRAY[OLD.account_id,OLD.to_account_id]; END IF;
        IF TG_OP<>'DELETE' THEN ids := ids || ARRAY[NEW.account_id,NEW.to_account_id]; END IF;
        FOR aid IN SELECT DISTINCT v FROM unnest(ids) v WHERE v IS NOT NULL ORDER BY v LOOP
          UPDATE accounts SET balance_revision=balance_revision+1 WHERE id=aid;
        END LOOP;
        RETURN NULL;
      END $$;
      CREATE TRIGGER wallet_tx_revision AFTER INSERT OR UPDATE OR DELETE ON transactions
        FOR EACH ROW EXECUTE FUNCTION wallet_transaction_revision();

      CREATE FUNCTION wallet_opening_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.initial_balance IS DISTINCT FROM OLD.initial_balance THEN
          NEW.balance_revision := OLD.balance_revision+1;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER wallet_opening_revision BEFORE UPDATE ON accounts
        FOR EACH ROW EXECUTE FUNCTION wallet_opening_revision();

      CREATE FUNCTION wallet_receipt_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE prior wallet_corrections; account_revision bigint; actual_ledger numeric; expected_current numeric;
      BEGIN
        SELECT a.balance_revision INTO account_revision FROM accounts a
          WHERE a.id=NEW.account_id AND a.family_id=NEW.family_id AND a.member_id=NEW.created_by
          FOR UPDATE;
        IF NOT FOUND OR NEW.revision<>account_revision+1 THEN
          RAISE EXCEPTION 'Wallet receipt revision is stale' USING ERRCODE='23514'; END IF;
        actual_ledger := public.wallet_ledger_balance(NEW.account_id,NULL);
        IF actual_ledger IS NULL OR actual_ledger<>NEW.ledger_after THEN
          RAISE EXCEPTION 'Wallet receipt ledger snapshot is invalid' USING ERRCODE='23514'; END IF;
        SELECT * INTO prior FROM wallet_corrections r WHERE r.account_id=NEW.account_id
          AND r.family_id=NEW.family_id ORDER BY r.revision DESC LIMIT 1;
        expected_current := NEW.ledger_before;
        IF prior.mode='reconciliation' THEN
          expected_current := prior.target_balance + NEW.ledger_before-prior.ledger_after;
        END IF;
        IF NEW.current_before<>expected_current THEN
          RAISE EXCEPTION 'Wallet receipt current snapshot is invalid' USING ERRCODE='23514'; END IF;
        UPDATE accounts SET balance_revision=NEW.revision WHERE id=NEW.account_id AND family_id=NEW.family_id;
        RETURN NEW;
      END $$;
      CREATE TRIGGER wallet_receipt_revision BEFORE INSERT ON wallet_corrections
        FOR EACH ROW EXECUTE FUNCTION wallet_receipt_revision();

      CREATE FUNCTION wallet_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Wallet correction receipts are immutable' USING ERRCODE='23514'; END $$;
      CREATE TRIGGER wallet_receipt_immutable BEFORE UPDATE OR DELETE ON wallet_corrections
        FOR EACH ROW EXECUTE FUNCTION wallet_receipt_immutable();
      CREATE FUNCTION wallet_adjustment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.source_kind='wallet_correction' THEN
          RAISE EXCEPTION 'Linked wallet adjustments are immutable' USING ERRCODE='23514';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END $$;
      CREATE TRIGGER wallet_adjustment_immutable BEFORE UPDATE OR DELETE ON transactions
        FOR EACH ROW EXECUTE FUNCTION wallet_adjustment_immutable();

      CREATE FUNCTION wallet_correction_link_valid() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME='transactions' THEN
          IF NEW.source_kind='wallet_correction' AND NOT EXISTS (
            SELECT 1 FROM wallet_corrections r WHERE r.transaction_id=NEW.id
            AND r.family_id=NEW.family_id AND r.created_by=NEW.member_id AND r.account_id=NEW.account_id
            AND r.mode='ledger' AND abs(r.delta)=NEW.amount
            AND ((r.delta>0 AND NEW.type='income') OR (r.delta<0 AND NEW.type='expense'))
          ) THEN RAISE EXCEPTION 'Wallet adjustment requires a matching receipt' USING ERRCODE='23514'; END IF;
        ELSIF NEW.transaction_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM transactions t WHERE t.id=NEW.transaction_id AND t.family_id=NEW.family_id
          AND t.source_kind='wallet_correction' AND t.account_id=NEW.account_id AND t.member_id=NEW.created_by
          AND abs(NEW.delta)=t.amount AND ((NEW.delta>0 AND t.type='income') OR (NEW.delta<0 AND t.type='expense'))
        ) THEN RAISE EXCEPTION 'Wallet receipt requires a matching adjustment' USING ERRCODE='23514'; END IF;
        RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER wallet_correction_tx_link AFTER INSERT OR UPDATE ON transactions
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_correction_link_valid();
      CREATE CONSTRAINT TRIGGER wallet_correction_receipt_link AFTER INSERT ON wallet_corrections
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_correction_link_valid();
    """)


def downgrade():
    # Refuse to discard audit history, even if this migration was applied accidentally.
    op.execute("""
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM wallet_corrections) THEN
        RAISE EXCEPTION 'Cannot downgrade wallets with correction history'; END IF; END $$;
      DROP TRIGGER wallet_adjustment_immutable ON transactions;
      DROP TRIGGER wallet_correction_tx_link ON transactions;
      DROP TRIGGER wallet_correction_receipt_link ON wallet_corrections;
      DROP FUNCTION wallet_correction_link_valid();
      DROP FUNCTION public.wallet_account_has_transactions(uuid);
      DROP FUNCTION public.wallet_ledger_balance(uuid,uuid);
      DROP FUNCTION wallet_adjustment_immutable();
      DROP TRIGGER wallet_tx_revision ON transactions;
      DROP FUNCTION wallet_transaction_revision();
      DROP TRIGGER wallet_opening_revision ON accounts;
      DROP FUNCTION wallet_opening_revision();
      DROP TRIGGER wallet_tx_statement ON transactions;
      DROP TRIGGER wallet_account_statement ON accounts;
      DROP TABLE wallet_corrections;
      DROP FUNCTION wallet_receipt_revision();
      DROP FUNCTION wallet_receipt_immutable();
      DROP FUNCTION wallet_financial_statement_lock();
      ALTER TABLE accounts DROP COLUMN balance_revision;
      ALTER TABLE transactions DROP CONSTRAINT ck_transactions_transaction_source_kind;
      ALTER TABLE transactions DROP CONSTRAINT ck_transactions_transaction_source_shape;
      ALTER TABLE transactions ADD CONSTRAINT ck_transactions_transaction_source_kind
        CHECK(source_kind IS NULL OR source_kind IN ('vehicle_service','transfer_fee'));
      ALTER TABLE transactions ADD CONSTRAINT ck_transactions_transaction_source_shape CHECK (
        source_kind IS NULL OR (source_kind='vehicle_service' AND type='expense' AND category='transport'
        AND repeat='none' AND repeat_end IS NULL) OR (source_kind='transfer_fee' AND type='expense'
        AND category='finance' AND repeat='none' AND repeat_end IS NULL AND transfer_fee_for_id IS NOT NULL));
    """)
