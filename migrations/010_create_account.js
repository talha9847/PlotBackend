async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS accounts (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      account_name VARCHAR(100) NOT NULL,
      bank_name VARCHAR(100),

      account_type VARCHAR(10) NOT NULL DEFAULT 'bank'
        CHECK (account_type IN ('cash', 'bank')),

      opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,

      current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_accounts_bank_name_by_type
        CHECK (
          (account_type = 'bank' AND bank_name IS NOT NULL)
          OR (account_type = 'cash' AND bank_name IS NULL)
        )
    );

    -- Ensure required columns exist for existing tables.
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14,2)
        NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN
        NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS account_type VARCHAR(10)
        NOT NULL DEFAULT 'bank',
      ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2)
        NOT NULL DEFAULT 0;

    -- Bank name is optional at the column level.
    ALTER TABLE accounts
      ALTER COLUMN bank_name DROP NOT NULL;

    -- Add constraints safely for existing tables.
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'accounts'::regclass
          AND conname = 'chk_accounts_account_type'
      ) THEN
        ALTER TABLE accounts
          ADD CONSTRAINT chk_accounts_account_type
          CHECK (account_type IN ('cash', 'bank'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'accounts'::regclass
          AND conname = 'chk_accounts_bank_name_by_type'
      ) THEN
        ALTER TABLE accounts
          ADD CONSTRAINT chk_accounts_bank_name_by_type
          CHECK (
            (account_type = 'bank' AND bank_name IS NOT NULL)
            OR (account_type = 'cash' AND bank_name IS NULL)
          );
      END IF;
    END $$;

    -- Convert a legacy CASH account instead of creating a duplicate.
    -- Only the lowest-id cash-like account is converted, and only
    -- when no account is already classified as cash.
    WITH candidate AS (
      SELECT id
      FROM accounts
      WHERE account_type <> 'cash'
        AND (
          LOWER(TRIM(account_name)) LIKE '%cash%'
          OR LOWER(TRIM(COALESCE(bank_name, ''))) LIKE '%cash%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM accounts
          WHERE account_type = 'cash'
        )
      ORDER BY id
      LIMIT 1
    )
    UPDATE accounts AS a
    SET
      account_type = 'cash',
      bank_name = NULL,
      account_name = CASE
        WHEN UPPER(TRIM(a.account_name)) = 'CASH'
          THEN 'Cash in Hand'
        ELSE a.account_name
      END,
      updated_at = NOW()
    FROM candidate AS c
    WHERE a.id = c.id;

    -- Ensure the surviving cash account is active.
    UPDATE accounts
    SET
      is_active = TRUE,
      updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM accounts
      WHERE account_type = 'cash'
      ORDER BY id
      LIMIT 1
    )
      AND NOT EXISTS (
        SELECT 1
        FROM accounts
        WHERE account_type = 'cash'
          AND is_active = TRUE
      );

    -- Seed Cash in Hand only when no cash account exists.
    INSERT INTO accounts (
      account_name,
      bank_name,
      account_type,
      opening_balance
    )
    SELECT 'Cash in Hand', NULL, 'cash', 0
    WHERE NOT EXISTS (
      SELECT 1
      FROM accounts
      WHERE account_type = 'cash'
    );

    -- Allow at most one active cash account.
    CREATE UNIQUE INDEX IF NOT EXISTS
      uq_accounts_single_active_cash
      ON accounts (account_type)
      WHERE account_type = 'cash'
        AND is_active = TRUE;

    CREATE INDEX IF NOT EXISTS idx_accounts_type_active
      ON accounts (account_type, is_active);

    -- Updated-at trigger function.
    CREATE OR REPLACE FUNCTION set_accounts_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger.
    DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;

    CREATE TRIGGER trg_accounts_updated_at
      BEFORE UPDATE ON accounts
      FOR EACH ROW
      EXECUTE FUNCTION set_accounts_updated_at();
  `);
}

module.exports = { up };
