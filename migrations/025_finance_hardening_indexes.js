"use strict";

async function up(client) {
  await client.query(`
    -- Phase 7 access-path hardening. The unified view is read with date,
    -- account, booking and status predicates, so keep those covering indexes
    -- present on every source table.
    CREATE INDEX IF NOT EXISTS idx_payments_booking_date
      ON payments (booking_id, payment_date DESC);

    CREATE INDEX IF NOT EXISTS idx_payments_booking_purpose_date
      ON payments (booking_id, payment_purpose, payment_date DESC);

    CREATE INDEX IF NOT EXISTS idx_payments_received_by
      ON payments (received_by)
      WHERE received_by IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_created_by
      ON financial_transactions (created_by)
      WHERE created_by IS NOT NULL
        AND deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_account_transfers_created_by
      ON account_transfers (created_by)
      WHERE created_by IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_payment_reversals_created_by
      ON payment_reversals (created_by)
      WHERE created_by IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_bookings_status_date
      ON bookings (status, booking_date DESC);

    CREATE INDEX IF NOT EXISTS idx_customer_plans_status
      ON customer_plans (status);

    -- Reconciliation reads refunds by original payment and status; duplicate
    -- index creation is intentional protection for databases that skipped 024.
    CREATE INDEX IF NOT EXISTS idx_payment_reversals_original
      ON payment_reversals (original_payment_id, status);
  `);
}

module.exports = { up };
