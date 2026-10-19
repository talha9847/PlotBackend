async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS bookings (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      booking_number VARCHAR(80) NOT NULL UNIQUE,

      project_id BIGINT NOT NULL
        REFERENCES projects(id) ON DELETE RESTRICT,

      plot_id BIGINT NOT NULL
        REFERENCES plots(id) ON DELETE RESTRICT,

      lead_id BIGINT NOT NULL
        REFERENCES leads(id) ON DELETE RESTRICT,

      customer_id BIGINT
        REFERENCES customers(id) ON DELETE RESTRICT,

      booking_date DATE NOT NULL DEFAULT CURRENT_DATE,

      agreed_price NUMERIC(14,2) NOT NULL
        CHECK (agreed_price >= 0),

      discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),

      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (tax_amount >= 0),

      total_amount NUMERIC(14,2) NOT NULL
        CHECK (total_amount >= 0),

      booking_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (booking_amount >= 0),

      status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (
          status IN (
            'pending',
            'reserved',
            'confirmed',
            'cancelled',
            'completed',
            'refunded'
          )
        ),

      cancellation_reason TEXT,
      notes TEXT,

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CHECK (discount_amount <= agreed_price),
      CHECK (booking_amount <= total_amount)
    );

    -- Regular indexes
    CREATE INDEX IF NOT EXISTS idx_bookings_project_id
      ON bookings (project_id);

    CREATE INDEX IF NOT EXISTS idx_bookings_plot_id
      ON bookings (plot_id);

    CREATE INDEX IF NOT EXISTS idx_bookings_lead_id
      ON bookings (lead_id);

    CREATE INDEX IF NOT EXISTS idx_bookings_customer_id
      ON bookings (customer_id);

    CREATE INDEX IF NOT EXISTS idx_bookings_status
      ON bookings (status);

    CREATE INDEX IF NOT EXISTS idx_bookings_booking_date
      ON bookings (booking_date);

    CREATE INDEX IF NOT EXISTS idx_bookings_created_by
      ON bookings (created_by);

    -- Prevent multiple active bookings for the same plot
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_active_plot
      ON bookings (plot_id)
      WHERE status IN ('pending', 'reserved', 'confirmed');

    -- Automatically update updated_at
    CREATE OR REPLACE FUNCTION set_bookings_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_bookings_updated_at
      ON bookings;

    CREATE TRIGGER trg_bookings_updated_at
      BEFORE UPDATE ON bookings
      FOR EACH ROW
      EXECUTE FUNCTION set_bookings_updated_at();
  `);
}

module.exports = { up };
