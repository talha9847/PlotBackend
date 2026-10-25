"use strict";

async function up(client) {
  await client.query(`
    -- Read-side indexes used by the unified ledger. Payments already have
    -- single-column indexes from migration 011; these support the common
    -- (status/date) and (account/date) access paths.
    CREATE INDEX IF NOT EXISTS idx_payments_status_payment_date
      ON payments (status, payment_date DESC);

    CREATE INDEX IF NOT EXISTS idx_payments_account_payment_date
      ON payments (account_id, payment_date DESC);

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_status_date
      ON financial_transactions (status, transaction_date DESC)
      WHERE deleted_at IS NULL;

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
    WHERE f.deleted_at IS NULL;
  `);
}

module.exports = { up };
