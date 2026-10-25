"use strict";

async function up(client) {
  await client.query(`
    -- Application-wide defence against duplicate network submissions. A key is
    -- scoped per operation so the same client-generated value can be reused by
    -- different workflows without colliding.
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      key VARCHAR(255) NOT NULL,
      scope VARCHAR(60) NOT NULL,
      resource_uuid UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT uq_idempotency_keys_key_scope UNIQUE (key, scope)
    );

    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
      ON idempotency_keys (created_at);

    -- Database-level enforcement that cash receipts land in the cash account
    -- and every non-cash receipt lands in a bank account. Application code also
    -- resolves this, but the trigger protects direct SQL and future writers.
    CREATE OR REPLACE FUNCTION assert_method_account_match()
    RETURNS TRIGGER AS $$
    DECLARE
      v_account_type VARCHAR(10);
      v_is_active BOOLEAN;
    BEGIN
      SELECT account_type, is_active
      INTO v_account_type, v_is_active
      FROM accounts
      WHERE id = NEW.account_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Account % does not exist', NEW.account_id;
      END IF;

      IF NOT v_is_active THEN
        RAISE EXCEPTION 'Account % is not active', NEW.account_id;
      END IF;

      IF NEW.payment_method = 'cash' AND v_account_type <> 'cash' THEN
        RAISE EXCEPTION
          'Cash payments must use the Cash in Hand account (account %)',
          NEW.account_id;
      END IF;

      IF NEW.payment_method <> 'cash' AND v_account_type <> 'bank' THEN
        RAISE EXCEPTION
          'Non-cash payments must use a bank account (account %)',
          NEW.account_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_payments_method_account_match ON payments;

    CREATE TRIGGER trg_payments_method_account_match
      BEFORE INSERT OR UPDATE OF payment_method, account_id ON payments
      FOR EACH ROW
      EXECUTE FUNCTION assert_method_account_match();

    DROP TRIGGER IF EXISTS trg_financial_transactions_method_account_match
      ON financial_transactions;

    CREATE TRIGGER trg_financial_transactions_method_account_match
      BEFORE INSERT OR UPDATE OF payment_method, account_id
      ON financial_transactions
      FOR EACH ROW
      EXECUTE FUNCTION assert_method_account_match();
  `);
}

module.exports = { up };
