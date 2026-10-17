async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS customer_plans (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      customer_id BIGINT NOT NULL
        REFERENCES customers(id) ON DELETE RESTRICT,

      booking_id BIGINT NOT NULL UNIQUE
        REFERENCES bookings(id) ON DELETE RESTRICT,

      down_payment NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (down_payment >= 0),

      installment_count INTEGER NOT NULL
        CHECK (installment_count > 0),

      frequency VARCHAR(24) NOT NULL DEFAULT 'monthly'
        CHECK (
          frequency IN (
            'weekly',
            'monthly',
            'quarterly',
            'half_yearly',
            'yearly',
            'milestone',
            'custom'
          )
        ),

      start_date DATE NOT NULL,

      status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (
          status IN ('active', 'completed', 'cancelled')
        ),
      remaining_balance NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (remaining_balance >= 0),
      notes TEXT,

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_plans_customer_id
      ON customer_plans(customer_id);

    CREATE OR REPLACE FUNCTION set_customer_plans_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_customer_plans_updated_at
      ON customer_plans;

    CREATE TRIGGER trg_customer_plans_updated_at
      BEFORE UPDATE ON customer_plans
      FOR EACH ROW
      EXECUTE FUNCTION set_customer_plans_updated_at();
  `);
}

module.exports = { up };
