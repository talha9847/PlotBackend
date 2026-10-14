const { pool } = require("../config/db");

async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      full_name VARCHAR(160) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone VARCHAR(30),
      password_hash TEXT NOT NULL,

      role VARCHAR(30) NOT NULL DEFAULT 'admin'
        CHECK (
          role IN (
            'admin',
            'manager',
            'accountant',
            'sales',
            'viewer'
          )
        ),

      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      email_verified_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      password_changed_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
      ON users (LOWER(email));

    CREATE INDEX IF NOT EXISTS idx_users_role_active
      ON users (role, is_active)
      WHERE deleted_at IS NULL;

    CREATE OR REPLACE FUNCTION set_users_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_users_updated_at ON users;

    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_users_updated_at();
  `);
}

module.exports = { up };
