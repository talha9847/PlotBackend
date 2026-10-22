async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS parties (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      name VARCHAR(160) NOT NULL,

      party_type VARCHAR(30) NOT NULL DEFAULT 'other'
        CHECK (
          party_type IN (
            'driver',
            'employee',
            'vendor',
            'supplier',
            'landlord',
            'customer',
            'broker',
            'other'
          )
        ),

      phone VARCHAR(30) UNIQUE NOT NULL,
      email VARCHAR(254),
      address TEXT,
      notes TEXT,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_parties_name
      ON parties (name);

    CREATE INDEX IF NOT EXISTS idx_parties_deleted_at
      ON parties (deleted_at);

    CREATE INDEX IF NOT EXISTS idx_parties_type_active
      ON parties (party_type, is_active)
      WHERE deleted_at IS NULL;

    -- Updated-at trigger function
    CREATE OR REPLACE FUNCTION set_parties_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger
    DROP TRIGGER IF EXISTS trg_parties_updated_at ON parties;

    CREATE TRIGGER trg_parties_updated_at
      BEFORE UPDATE ON parties
      FOR EACH ROW
      EXECUTE FUNCTION set_parties_updated_at();
  `);
}

module.exports = { up };
