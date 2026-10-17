async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS payments (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      payment_number VARCHAR(80) NOT NULL UNIQUE,

      booking_id BIGINT NOT NULL
        REFERENCES bookings(id) ON DELETE RESTRICT,

      customer_id BIGINT NOT NULL
        REFERENCES customers(id) ON DELETE RESTRICT,

      installment_id BIGINT
        REFERENCES installments(id) ON DELETE RESTRICT,

      account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,

      payment_method VARCHAR(24) NOT NULL
        CHECK (
          payment_method IN (
            'cash',
            'upi',
            'bank_transfer',
            'card',
            'cheque',
            'other'
          )
        ),

      amount NUMERIC(14,2) NOT NULL
        CHECK (amount > 0),

      currency_code CHAR(3) NOT NULL DEFAULT 'INR',

      payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      transaction_reference VARCHAR(150),

      received_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      status VARCHAR(24) NOT NULL DEFAULT 'completed'
        CHECK (
          status IN (
            'pending',
            'completed',
            'failed',
            'cancelled',
            'partially_refunded',
            'refunded'
          )
        ),

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_payments_booking_id
      ON payments (booking_id);

    CREATE INDEX IF NOT EXISTS idx_payments_customer_id
      ON payments (customer_id);

    CREATE INDEX IF NOT EXISTS idx_payments_installment_id
      ON payments (installment_id);

    CREATE INDEX IF NOT EXISTS idx_payments_account_id
      ON payments (account_id);

    CREATE INDEX IF NOT EXISTS idx_payments_payment_date
      ON payments (payment_date);

    CREATE INDEX IF NOT EXISTS idx_payments_status
      ON payments (status);

    -- Updated-at trigger function
    CREATE OR REPLACE FUNCTION set_payments_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger
    DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;

    CREATE TRIGGER trg_payments_updated_at
      BEFORE UPDATE ON payments
      FOR EACH ROW
      EXECUTE FUNCTION set_payments_updated_at();
  `);
}

module.exports = { up };
