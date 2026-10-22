async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS plots (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      project_id BIGINT NOT NULL
        REFERENCES projects(id) ON DELETE RESTRICT,

      plot_number VARCHAR(80) NOT NULL,

      plot_type VARCHAR(30) NOT NULL DEFAULT 'residential'
        CHECK (
          plot_type IN (
            'residential',
            'commercial',
            'industrial',
            'agricultural',
            'other'
          )
        ),

      base_price NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (base_price >= 0),

      status VARCHAR(24) NOT NULL DEFAULT 'available'
        CHECK (
          status IN (
            'available',
            'reserved',
            'booked',
            'sold',
            'blocked',
            'under_development'
          )
        ),

      notes TEXT,

      length NUMERIC(10,2) 
        CHECK (length > 0),

      breadth NUMERIC(10,2)  
        CHECK (breadth > 0),

      dimension VARCHAR(5) NOT NULL DEFAULT 'ft'
        CHECK (dimension IN ('ft', 'mt')),

      area NUMERIC(14,2)
        GENERATED ALWAYS AS (length * breadth) STORED,

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,

      CONSTRAINT uq_plots_project_plot_number
        UNIQUE (project_id, plot_number)
    );

    CREATE INDEX IF NOT EXISTS idx_plots_project_id
      ON plots (project_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_plots_status
      ON plots (status)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_plots_type
      ON plots (plot_type)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_plots_created_by
      ON plots (created_by);

    CREATE OR REPLACE FUNCTION set_plots_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_plots_updated_at
      ON plots;

    CREATE TRIGGER trg_plots_updated_at
      BEFORE UPDATE ON plots
      FOR EACH ROW
      EXECUTE FUNCTION set_plots_updated_at();
  `);
}

module.exports = { up };
