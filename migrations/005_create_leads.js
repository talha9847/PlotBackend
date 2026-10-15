async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS leads (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) UNIQUE NOT NULL,
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

      broker_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

      address_line1 TEXT,
      address_line2 TEXT,
      city VARCHAR(100),
      district VARCHAR(100),
      state VARCHAR(100),
      postal_code VARCHAR(20),
      country_code CHAR(2) NOT NULL DEFAULT 'IN',

      notes TEXT,

      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

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

    CREATE INDEX IF NOT EXISTS idx_leads_broker_id
      ON leads (broker_id);

    CREATE INDEX IF NOT EXISTS idx_leads_created_by
      ON leads (created_by);

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
