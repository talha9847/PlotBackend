"use strict";

const { pool } = require("../config/db");

async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS brokers (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL UNIQUE,
      alternate_phone VARCHAR(30),
      email VARCHAR(254) UNIQUE NOT NULL,

      address_line1 TEXT,
      address_line2 TEXT,
      city VARCHAR(100),
      district VARCHAR(100),
      state VARCHAR(100),
      postal_code VARCHAR(20),
      country_code CHAR(2) NOT NULL DEFAULT 'IN',

      notes TEXT,

      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_brokers_phone
      ON brokers (phone);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_brokers_email_lower
      ON brokers (LOWER(email))
      WHERE email IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_brokers_city
      ON brokers (city);

    CREATE INDEX IF NOT EXISTS idx_brokers_deleted_at
      ON brokers (deleted_at);

    CREATE OR REPLACE FUNCTION set_brokers_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_brokers_updated_at ON brokers;

    CREATE TRIGGER trg_brokers_updated_at
      BEFORE UPDATE ON brokers
      FOR EACH ROW
      EXECUTE FUNCTION set_brokers_updated_at();
  `);
}

module.exports = { up };
