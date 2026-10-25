"use strict";

async function up(client) {
  await client.query(`
    -- 1. Allow customer_id to be NULL on payments (needed for pre-confirmation
    -- booking tokens). The CHECK below still requires it for installments.
    ALTER TABLE payments
      ALTER COLUMN customer_id DROP NOT NULL;

    -- 2. Enforce that installment payments MUST have a customer_id.
    DO $$
    DECLARE
      v_invalid_count INTEGER;
    BEGIN
      SELECT COUNT(*)::int
      INTO v_invalid_count
      FROM payments
      WHERE installment_id IS NOT NULL
        AND customer_id IS NULL;

      IF v_invalid_count > 0 THEN
        RAISE EXCEPTION
          'Cannot enforce installment customer ownership: % installment payment(s) have no customer_id. Reconcile them before running migration 019.',
          v_invalid_count;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'payments'::regclass
          AND conname = 'chk_payments_installment_requires_customer'
      ) THEN
        ALTER TABLE payments
          ADD CONSTRAINT chk_payments_installment_requires_customer
          CHECK (installment_id IS NULL OR customer_id IS NOT NULL);
      END IF;
    END $$;

    -- 3. Add payment_purpose without assuming the table is empty. Existing
    -- rows are explicitly classified as installment receipts.
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS payment_purpose VARCHAR(30);

    UPDATE payments
    SET payment_purpose = 'installment'
    WHERE payment_purpose IS NULL;

    ALTER TABLE payments
      ALTER COLUMN payment_purpose SET DEFAULT 'installment';

    ALTER TABLE payments
      ALTER COLUMN payment_purpose SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'payments'::regclass
          AND conname = 'chk_payments_payment_purpose'
      ) THEN
        ALTER TABLE payments
          ADD CONSTRAINT chk_payments_payment_purpose
          CHECK (payment_purpose IN ('booking_token', 'down_payment', 'installment'));
      END IF;
    END $$;

    -- 4. Fast lookup by booking and purpose.
    CREATE INDEX IF NOT EXISTS idx_payments_booking_purpose
      ON payments (booking_id, payment_purpose);

    -- 5. A booking may have at most one token and one down-payment receipt.
    -- Installment receipts remain repeatable. Fail with an actionable message
    -- instead of a raw unique-index violation when legacy duplicates exist.
    DO $$
    DECLARE
      v_duplicate RECORD;
    BEGIN
      SELECT
        booking_id,
        payment_purpose,
        COUNT(*)::int AS receipt_count
      INTO v_duplicate
      FROM payments
      WHERE payment_purpose IN ('booking_token', 'down_payment')
      GROUP BY booking_id, payment_purpose
      HAVING COUNT(*) > 1
      ORDER BY booking_id, payment_purpose
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION
          'Cannot enforce one receipt per booking and purpose: booking % has % duplicate % receipt(s). Reconcile the duplicates before running migration 019.',
          v_duplicate.booking_id,
          v_duplicate.receipt_count,
          v_duplicate.payment_purpose;
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_booking_receipt_purpose
      ON payments (booking_id, payment_purpose)
      WHERE payment_purpose IN ('booking_token', 'down_payment');
  `);
}

module.exports = { up };
