"use strict";

async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_reversals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      reversal_number VARCHAR(80) NOT NULL UNIQUE,

      original_payment_id BIGINT NOT NULL
        REFERENCES payments(id) ON DELETE RESTRICT,

      reversal_type VARCHAR(20) NOT NULL DEFAULT 'refund'
        CHECK (reversal_type IN ('refund')),

      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),

      account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,

      reason TEXT NOT NULL,

      status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'cancelled')),

      method VARCHAR(24) NOT NULL
        CHECK (
          method IN (
            'cash',
            'upi',
            'bank_transfer',
            'card',
            'cheque',
            'other'
          )
        ),

      reference_number VARCHAR(150),
      reversal_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payment_reversals_original
      ON payment_reversals (original_payment_id, status);

    CREATE INDEX IF NOT EXISTS idx_payment_reversals_account_date
      ON payment_reversals (account_id, reversal_date DESC);

    CREATE INDEX IF NOT EXISTS idx_payment_reversals_status_date
      ON payment_reversals (status, reversal_date DESC);

    CREATE OR REPLACE FUNCTION set_payment_reversals_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_payment_reversals_updated_at
      ON payment_reversals;

    CREATE TRIGGER trg_payment_reversals_updated_at
      BEFORE UPDATE ON payment_reversals
      FOR EACH ROW
      EXECUTE FUNCTION set_payment_reversals_updated_at();

    -- Refunds are limited by the original receipt. The row lock serialises
    -- concurrent refund attempts for the same payment before the sum is read.
    CREATE OR REPLACE FUNCTION assert_refund_within_limit()
    RETURNS TRIGGER AS $$
    DECLARE
      v_payment_amount NUMERIC(14,2);
      v_refunded NUMERIC(14,2);
      v_new_amount NUMERIC(14,2);
    BEGIN
      IF TG_OP = 'UPDATE'
         AND NEW.original_payment_id <> OLD.original_payment_id THEN
        RAISE EXCEPTION 'A refund cannot be moved to another payment';
      END IF;

      SELECT amount
      INTO v_payment_amount
      FROM payments
      WHERE id = NEW.original_payment_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Original payment % does not exist',
          NEW.original_payment_id;
      END IF;

      IF NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount must be greater than zero';
      END IF;

      SELECT COALESCE(SUM(amount), 0)
      INTO v_refunded
      FROM payment_reversals
      WHERE original_payment_id = NEW.original_payment_id
        AND status IN ('pending', 'completed')
        AND (TG_OP = 'INSERT' OR id <> NEW.id);

      v_new_amount :=
        CASE
          WHEN NEW.status IN ('pending', 'completed') THEN NEW.amount
          ELSE 0
        END;

      IF v_refunded + v_new_amount > v_payment_amount THEN
        RAISE EXCEPTION
          'Refund total (%) exceeds the original payment amount (%)',
          v_refunded + v_new_amount,
          v_payment_amount;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_payment_reversals_refund_limit
      ON payment_reversals;

    CREATE TRIGGER trg_payment_reversals_refund_limit
      BEFORE INSERT OR UPDATE ON payment_reversals
      FOR EACH ROW
      EXECUTE FUNCTION assert_refund_within_limit();

    -- Refunds must also obey the cash/bank account rule.
    CREATE OR REPLACE FUNCTION assert_reversal_method_account_match()
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

      IF NEW.method = 'cash' AND v_account_type <> 'cash' THEN
        RAISE EXCEPTION
          'Cash refunds must use the Cash in Hand account (account %)',
          NEW.account_id;
      END IF;

      IF NEW.method <> 'cash' AND v_account_type <> 'bank' THEN
        RAISE EXCEPTION
          'Non-cash refunds must use a bank account (account %)',
          NEW.account_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_payment_reversals_method_account_match
      ON payment_reversals;

    CREATE TRIGGER trg_payment_reversals_method_account_match
      BEFORE INSERT OR UPDATE OF method, account_id ON payment_reversals
      FOR EACH ROW
      EXECUTE FUNCTION assert_reversal_method_account_match();

    CREATE OR REPLACE VIEW v_unified_transactions AS
    SELECT
      'payment'::text AS source_type,
      p.uuid AS source_uuid,
      p.id::text AS source_row_id,
      p.payment_number::text AS transaction_number,

      COALESCE(p.payment_purpose, 'installment')::text AS kind,
      'credit'::text AS direction,
      p.amount,
      p.account_id,
      a.account_type::text AS channel,

      CASE p.status
        WHEN 'completed' THEN 'completed'
        WHEN 'pending' THEN 'pending'
        WHEN 'failed' THEN 'failed'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'partially_refunded' THEN 'partially_refunded'
        WHEN 'refunded' THEN 'refunded'
        ELSE 'pending'
      END::text AS status,

      p.payment_method::text AS payment_method,
      p.booking_id,
      COALESCE(p.customer_id, b.customer_id) AS customer_id,
      NULL::bigint AS party_id,
      NULL::bigint AS category_id,
      p.installment_id,
      p.received_by AS created_by,
      p.payment_date AS transaction_date,
      p.transaction_reference::text AS reference_number,
      p.notes,
      (p.status IN ('completed', 'partially_refunded', 'refunded'))
        AS counts_as_balance,
      (p.status IN ('completed', 'partially_refunded', 'refunded'))
        AS counts_as_cash_flow,
      p.created_at,
      p.updated_at
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    INNER JOIN accounts a ON a.id = p.account_id

    UNION ALL

    SELECT
      'financial_transaction'::text AS source_type,
      f.uuid AS source_uuid,
      f.id::text AS source_row_id,
      f.transaction_number::text AS transaction_number,

      f.transaction_type::text AS kind,
      CASE
        WHEN f.transaction_type = 'income' THEN 'credit'
        ELSE 'debit'
      END::text AS direction,
      f.amount,
      f.account_id,
      a.account_type::text AS channel,

      CASE f.status
        WHEN 'posted' THEN 'completed'
        WHEN 'pending' THEN 'pending'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
      END::text AS status,

      f.payment_method::text AS payment_method,
      NULL::bigint AS booking_id,
      NULL::bigint AS customer_id,
      f.party_id,
      f.category_id,
      NULL::bigint AS installment_id,
      f.created_by,
      f.transaction_date,
      f.reference_number::text AS reference_number,
      f.notes,
      (f.status = 'posted') AS counts_as_balance,
      (f.status = 'posted') AS counts_as_cash_flow,
      f.created_at,
      f.updated_at
    FROM financial_transactions f
    INNER JOIN accounts a ON a.id = f.account_id
    WHERE f.deleted_at IS NULL

    UNION ALL

    -- Transfer legs: balance-affecting, excluded from cash flow.
    SELECT
      'account_transfer'::text AS source_type,
      t.uuid AS source_uuid,
      t.uuid::text || '-debit' AS source_row_id,
      t.transfer_number::text AS transaction_number,

      'transfer'::text AS kind,
      'debit'::text AS direction,
      t.amount,
      t.from_account_id AS account_id,
      a.account_type::text AS channel,

      'completed'::text AS status,

      NULL::text AS payment_method,
      NULL::bigint AS booking_id,
      NULL::bigint AS customer_id,
      NULL::bigint AS party_id,
      NULL::bigint AS category_id,
      NULL::bigint AS installment_id,
      t.created_by,
      t.transfer_date AS transaction_date,
      t.reference_number::text AS reference_number,
      t.notes,
      TRUE AS counts_as_balance,
      FALSE AS counts_as_cash_flow,
      t.created_at,
      t.updated_at
    FROM account_transfers t
    INNER JOIN accounts a ON a.id = t.from_account_id

    UNION ALL

    SELECT
      'account_transfer'::text AS source_type,
      t.uuid AS source_uuid,
      t.uuid::text || '-credit' AS source_row_id,
      t.transfer_number::text AS transaction_number,

      'transfer'::text AS kind,
      'credit'::text AS direction,
      t.amount,
      t.to_account_id AS account_id,
      a.account_type::text AS channel,

      'completed'::text AS status,

      NULL::text AS payment_method,
      NULL::bigint AS booking_id,
      NULL::bigint AS customer_id,
      NULL::bigint AS party_id,
      NULL::bigint AS category_id,
      NULL::bigint AS installment_id,
      t.created_by,
      t.transfer_date AS transaction_date,
      t.reference_number::text AS reference_number,
      t.notes,
      TRUE AS counts_as_balance,
      FALSE AS counts_as_cash_flow,
      t.created_at,
      t.updated_at
    FROM account_transfers t
    INNER JOIN accounts a ON a.id = t.to_account_id

    UNION ALL

    -- A refund is an offsetting debit against the original receipt. The
    -- original remains a credit, so inflow/outflow stay symmetrical.
    SELECT
      'payment_reversal'::text AS source_type,
      r.uuid AS source_uuid,
      r.id::text AS source_row_id,
      r.reversal_number::text AS transaction_number,

      'refund'::text AS kind,
      'debit'::text AS direction,
      r.amount,
      r.account_id,
      a.account_type::text AS channel,

      CASE r.status
        WHEN 'completed' THEN 'completed'
        WHEN 'pending' THEN 'pending'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
      END::text AS status,

      r.method::text AS payment_method,
      p.booking_id,
      COALESCE(p.customer_id, b.customer_id) AS customer_id,
      NULL::bigint AS party_id,
      NULL::bigint AS category_id,
      p.installment_id,
      r.created_by,
      r.reversal_date AS transaction_date,
      r.reference_number::text AS reference_number,
      r.reason AS notes,
      (r.status = 'completed') AS counts_as_balance,
      (r.status = 'completed') AS counts_as_cash_flow,
      r.created_at,
      r.updated_at
    FROM payment_reversals r
    INNER JOIN payments p ON p.id = r.original_payment_id
    LEFT JOIN bookings b ON b.id = p.booking_id
    INNER JOIN accounts a ON a.id = r.account_id;
  `);
}

module.exports = { up };
