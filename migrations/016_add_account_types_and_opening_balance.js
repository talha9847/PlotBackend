async function up(client) {
  await client.query(`
    -- Account classification and opening balances
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS account_type VARCHAR(10)
        NOT NULL DEFAULT 'bank',
      ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2)
        NOT NULL DEFAULT 0;

    -- Only bank accounts carry a bank name from now on
    ALTER TABLE accounts
      ALTER COLUMN bank_name DROP NOT NULL;

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

    -- Convert the legacy CASH account instead of seeding a duplicate.
    -- Only the lowest-id cash-like account is converted.
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
        WHEN UPPER(TRIM(a.account_name)) = 'CASH' THEN 'Cash in Hand'
        ELSE a.account_name
      END,
      updated_at = NOW()
    FROM candidate AS c
    WHERE a.id = c.id;

    -- Make sure the surviving cash account is active.
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

    -- Seed Cash in Hand only when no cash account exists at all.
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

    -- Exactly one active cash account is allowed.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_single_active_cash
      ON accounts (account_type)
      WHERE account_type = 'cash'
        AND is_active = TRUE;

    CREATE INDEX IF NOT EXISTS idx_accounts_type_active
      ON accounts (account_type, is_active);
  `);
}

module.exports = { up };
