async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS projects (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      name VARCHAR(100) NOT NULL UNIQUE,

      plots INTEGER NOT NULL DEFAULT 0
        CHECK (plots >= 0),

      project_type VARCHAR(40) NOT NULL DEFAULT 'residential'
        CHECK (
          project_type IN (
            'residential',
            'commercial',
            'industrial',
            'mixed_use',
            'agricultural',
            'other'
          )
        ),

      status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (
          status IN (
            'planning',
            'active',
            'on_hold',
            'completed',
            'archived'
          )
        ),

      address_line1 TEXT,
      address_line2 TEXT,
      city VARCHAR(100),
      district VARCHAR(100),
      state VARCHAR(100),
      postal_code VARCHAR(20),

      total_area NUMERIC(16,3)
        CHECK (total_area IS NULL OR total_area >= 0),

      area_unit VARCHAR(20) NOT NULL DEFAULT 'sq_ft'
        CHECK (
          area_unit IN (
            'sq_ft',
            'sq_m',
            'sq_yd',
            'acre',
            'hectare',
            'guntha',
            'bigha',
            'other'
          )
        ),

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status
      ON projects (status)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_projects_type
      ON projects (project_type)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_projects_created_by
      ON projects (created_by);

    CREATE INDEX IF NOT EXISTS idx_projects_city
      ON projects (city)
      WHERE deleted_at IS NULL;

    CREATE OR REPLACE FUNCTION set_projects_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_projects_updated_at
      ON projects;

    CREATE TRIGGER trg_projects_updated_at
      BEFORE UPDATE ON projects
      FOR EACH ROW
      EXECUTE FUNCTION set_projects_updated_at();
  `);
}

module.exports = { up };
