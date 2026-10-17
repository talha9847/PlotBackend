async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS installments (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      customer_plan_id BIGINT NOT NULL
        REFERENCES customer_plans(id) ON DELETE RESTRICT,

      installment_number INTEGER NOT NULL
        CHECK (installment_number > 0),

      description VARCHAR(200),

      due_date DATE NOT NULL,

      amount_due NUMERIC(14,2) NOT NULL
        CHECK (amount_due >= 0),

      amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (amount_paid >= 0),

      late_fee NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (late_fee >= 0),

      status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (
          status IN (
            'pending',
            'partially_paid',
            'paid',
            'overdue',
            'waived',
            'cancelled'
          )
        ),

      paid_at TIMESTAMPTZ,

      notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (customer_plan_id, installment_number),

      CHECK (amount_paid <= amount_due + late_fee)
    );

    CREATE INDEX IF NOT EXISTS idx_installments_customer_plan_id
      ON installments(customer_plan_id);

    CREATE INDEX IF NOT EXISTS idx_installments_due_date_status
      ON installments(due_date, status);

    CREATE OR REPLACE FUNCTION set_installments_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_installments_updated_at
      ON installments;

    CREATE TRIGGER trg_installments_updated_at
      BEFORE UPDATE ON installments
      FOR EACH ROW
      EXECUTE FUNCTION set_installments_updated_at();
  `);
}

module.exports = { up };
