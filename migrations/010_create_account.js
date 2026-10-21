async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS accounts (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      account_name VARCHAR(100) NOT NULL,
      bank_name VARCHAR(100) NOT NULL,

      current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Ensure required columns exist for existing tables
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14,2)
        NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN
        NOT NULL DEFAULT TRUE;

    -- Updated-at trigger function
    CREATE OR REPLACE FUNCTION set_accounts_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger
    DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;

    CREATE TRIGGER trg_accounts_updated_at
      BEFORE UPDATE ON accounts
      FOR EACH ROW
      EXECUTE FUNCTION set_accounts_updated_at();

    -- Create the default CASH account if it does not exist
    INSERT INTO accounts (account_name, bank_name)
    SELECT 'CASH', 'Cash'
    WHERE NOT EXISTS (
      SELECT 1
      FROM accounts
      WHERE UPPER(account_name) = 'CASH'
    );
  `);
}

module.exports = { up };
