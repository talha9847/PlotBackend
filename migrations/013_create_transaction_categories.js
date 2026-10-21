async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS transaction_categories (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_transaction_categories_deleted_at
      ON transaction_categories (deleted_at);

    CREATE INDEX IF NOT EXISTS idx_transaction_categories_active
      ON transaction_categories (is_active)
      WHERE deleted_at IS NULL;

    -- Updated-at trigger function
    CREATE OR REPLACE FUNCTION set_transaction_categories_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger
    DROP TRIGGER IF EXISTS trg_transaction_categories_updated_at
      ON transaction_categories;

    CREATE TRIGGER trg_transaction_categories_updated_at
      BEFORE UPDATE ON transaction_categories
      FOR EACH ROW
      EXECUTE FUNCTION set_transaction_categories_updated_at();
  `);
}

module.exports = { up };
