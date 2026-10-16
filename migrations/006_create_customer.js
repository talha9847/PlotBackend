async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS customers (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      lead_id BIGINT NOT NULL UNIQUE
        REFERENCES leads(id) ON DELETE RESTRICT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customers_created_at
      ON customers (created_at);

    CREATE OR REPLACE FUNCTION set_customers_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_customers_updated_at
      ON customers;

    CREATE TRIGGER trg_customers_updated_at
      BEFORE UPDATE ON customers
      FOR EACH ROW
      EXECUTE FUNCTION set_customers_updated_at();
  `);
}

module.exports = { up };