"use strict";

async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS account_transfers (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      transfer_number VARCHAR(80) NOT NULL UNIQUE,

      from_account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,
      to_account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,

      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),

      transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      reference_number VARCHAR(150),
      notes TEXT,

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_account_transfers_distinct_accounts
        CHECK (from_account_id <> to_account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_account_transfers_from_date
      ON account_transfers (from_account_id, transfer_date DESC);

    CREATE INDEX IF NOT EXISTS idx_account_transfers_to_date
      ON account_transfers (to_account_id, transfer_date DESC);

    CREATE INDEX IF NOT EXISTS idx_account_transfers_transfer_date
      ON account_transfers (transfer_date DESC);

    CREATE OR REPLACE FUNCTION set_account_transfers_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_account_transfers_updated_at
      ON account_transfers;

    CREATE TRIGGER trg_account_transfers_updated_at
      BEFORE UPDATE ON account_transfers
      FOR EACH ROW
      EXECUTE FUNCTION set_account_transfers_updated_at();

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

    -- A transfer is represented by two signed legs. The legs affect account
    -- balances but are deliberately excluded from inflow/outflow, because a
    -- transfer moves money between accounts rather than creating or consuming
    -- cash.
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
    INNER JOIN accounts a ON a.id = t.to_account_id;
  `);
}

module.exports = { up };
