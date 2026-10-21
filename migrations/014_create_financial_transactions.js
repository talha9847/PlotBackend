async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      transaction_number VARCHAR(80) NOT NULL UNIQUE,

      transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('income', 'expense')),

      account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,

      party_id BIGINT
        REFERENCES parties(id) ON DELETE RESTRICT,

      category_id BIGINT NOT NULL
        REFERENCES transaction_categories(id) ON DELETE RESTRICT,

      amount NUMERIC(14,2) NOT NULL
        CHECK (amount > 0),

      transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      payment_method VARCHAR(24) NOT NULL DEFAULT 'cash'
        CHECK (
          payment_method IN (
            'cash',
            'upi',
            'bank_transfer',
            'card',
            'cheque',
            'other'
          )
        ),

      status VARCHAR(20) NOT NULL DEFAULT 'posted'
        CHECK (status IN ('pending', 'posted', 'cancelled')),

      reference_number VARCHAR(100),
      notes TEXT,

      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      updated_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_financial_transactions_account_date
      ON financial_transactions (account_id, transaction_date DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_party
      ON financial_transactions (party_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_category
      ON financial_transactions (category_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_type_status
      ON financial_transactions (transaction_type, status)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_deleted_at
      ON financial_transactions (deleted_at);

    -- Updated-at trigger function
    CREATE OR REPLACE FUNCTION set_financial_transactions_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Updated-at trigger
    DROP TRIGGER IF EXISTS trg_financial_transactions_updated_at
      ON financial_transactions;

    CREATE TRIGGER trg_financial_transactions_updated_at
      BEFORE UPDATE ON financial_transactions
      FOR EACH ROW
      EXECUTE FUNCTION set_financial_transactions_updated_at();
  `);
}

module.exports = { up };
