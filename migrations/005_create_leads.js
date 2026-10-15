async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS leads (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      -- Lead details
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      alternate_phone VARCHAR(30),
      email VARCHAR(254),

      lead_type VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (
          lead_type IN (
            'individual',
            'company',
            'partnership',
            'trust',
            'other'
          )
        ),

      company_name VARCHAR(200),

      -- Project and plot interest
      project_id BIGINT
        REFERENCES projects(id) ON DELETE RESTRICT,

      plot_id BIGINT
        REFERENCES plots(id) ON DELETE RESTRICT,

      -- Assigned broker
      broker_id BIGINT
        REFERENCES brokers(id) ON DELETE SET NULL,

      -- Address
      address_line1 TEXT,
      address_line2 TEXT,
      city VARCHAR(100),
      district VARCHAR(100),
      state VARCHAR(100),
      postal_code VARCHAR(20),
      country_code CHAR(2) NOT NULL DEFAULT 'IN',

      notes TEXT,

      -- Audit fields
      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      updated_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      -- Timestamps and soft delete
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    -- Unique phone number among active leads only
    CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_phone_active
      ON leads (phone)
      WHERE deleted_at IS NULL;

    -- Active lead search indexes
    CREATE INDEX IF NOT EXISTS idx_leads_name
      ON leads (LOWER(name))
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_phone
      ON leads (phone)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_email_lower
      ON leads (LOWER(email))
      WHERE email IS NOT NULL
        AND deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_type
      ON leads (lead_type)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_project_id
      ON leads (project_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_plot_id
      ON leads (plot_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_broker_id
      ON leads (broker_id);

    CREATE INDEX IF NOT EXISTS idx_leads_created_by
      ON leads (created_by);

    -- Automatically update updated_at
    CREATE OR REPLACE FUNCTION set_leads_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;

    CREATE TRIGGER trg_leads_updated_at
      BEFORE UPDATE ON leads
      FOR EACH ROW
      EXECUTE FUNCTION set_leads_updated_at();
  `);
}

module.exports = { up };