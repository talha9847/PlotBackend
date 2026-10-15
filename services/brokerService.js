"use strict";

const { pool, query } = require("../config/db");
const bcrypt = require("bcrypt");

// Only these columns can be used for sorting.
const SORT_COLUMNS = {
  name: "name",
  phone: "phone",
  email: "email",
  city: "city",
  district: "district",
  state: "state",
  created_at: "created_at",
  updated_at: "updated_at",
};

async function createBroker(data, createdBy = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      name,
      phone,
      alternate_phone,
      email,
      address_line1,
      address_line2,
      city,
      district,
      state,
      postal_code,
      country_code = "IN",
      notes,
    } = data;

    // 1. Create broker record
    const brokerResult = await client.query(
      `INSERT INTO brokers (
        name,
        phone,
        alternate_phone,
        email,
        address_line1,
        address_line2,
        city,
        district,
        state,
        postal_code,
        country_code,
        notes,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13
      )
      RETURNING *`,
      [
        name,
        phone,
        alternate_phone || null,
        email || null,
        address_line1 || null,
        address_line2 || null,
        city || null,
        district || null,
        state || null,
        postal_code || null,
        country_code,
        notes || null,
        createdBy,
      ],
    );

    const broker = brokerResult.rows[0];

    const loginEmail = email?.trim() || `${phone.trim()}@broker.local`;

    const defaultPassword = `Broker@123`;

    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // 4. Create broker login in users table
    await client.query(
      `INSERT INTO users (
        full_name,
        email,
        phone,
        password_hash,
        role,
        is_active
      )
      VALUES ($1, $2, $3, $4, 'broker', TRUE)`,
      [name, loginEmail, phone, passwordHash],
    );

    // 5. Commit both inserts
    await client.query("COMMIT");

    return {
      ...broker,
      login: {
        email: loginEmail,
        defaultPassword,
        role: "broker",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getBrokers({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
} = {}) {
  // Normalize and validate pagination values.
  page = Math.max(1, Math.trunc(Number(page) || 1));
  limit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 10)));

  const offset = (page - 1) * limit;

  // Whitelist sort columns and direction.
  const sortColumn = SORT_COLUMNS[sortBy] || "created_at";
  const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const conditions = ["deleted_at IS NULL"];
  const values = [];

  if (search && String(search).trim()) {
    values.push(`%${String(search).trim()}%`);
    const index = values.length;

    conditions.push(`(
      name ILIKE $${index}
      OR phone ILIKE $${index}
      OR COALESCE(alternate_phone, '') ILIKE $${index}
      OR COALESCE(email, '') ILIKE $${index}
      OR COALESCE(city, '') ILIKE $${index}
      OR COALESCE(district, '') ILIKE $${index}
      OR COALESCE(state, '') ILIKE $${index}
      OR COALESCE(postal_code, '') ILIKE $${index}
    )`);
  }

  const whereClause = conditions.join(" AND ");

  // Count uses the same filters as the data query.
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM brokers
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total;
  const totalPages = Math.ceil(total / limit);

  const dataValues = [...values, limit, offset];

  const result = await query(
    `SELECT
       id, uuid, name, phone, alternate_phone, email,
       address_line1, address_line2, city, district,
       state, postal_code, country_code, notes,
       created_by, updated_by, created_at, updated_at
     FROM brokers
     WHERE ${whereClause}
     ORDER BY ${sortColumn} ${direction}, id DESC
     LIMIT $${dataValues.length - 1}
     OFFSET $${dataValues.length}`,
    dataValues,
  );

  return {
    brokers: result.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && total > 0,
    },
  };
}

async function getBrokerByUuid(uuid) {
  const result = await query(
    `SELECT
       id, uuid, name, phone, alternate_phone, email,
       address_line1, address_line2, city, district,
       state, postal_code, country_code, notes,
       created_by, updated_by, created_at, updated_at
     FROM brokers
     WHERE uuid = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [uuid],
  );

  return result.rows[0] || null;
}

async function updateBrokerByUuid(uuid, data, updatedBy = null) {
  const {
    name,
    phone,
    email,
    country_code,
    alternate_phone,
    address_line1,
    address_line2,
    city,
    district,
    state,
    postal_code,
    notes,
  } = data;

  const { rows } = await query(
    `UPDATE brokers
     SET
       name = $1,
       phone = $2,
       email = $3,
       country_code = $4,
       alternate_phone = $5,
       address_line1 = $6,
       address_line2 = $7,
       city = $8,
       district = $9,
       state = $10,
       postal_code = $11,
       notes = $12,
       updated_by = $13,
       updated_at = NOW()
     WHERE uuid = $14
       AND deleted_at IS NULL
     RETURNING
       id, uuid, name, phone, alternate_phone, email,
       address_line1, address_line2, city, district,
       state, postal_code, country_code, notes,
       created_by, updated_by, created_at, updated_at`,
    [
      name,
      phone,
      email ?? null,
      country_code ?? "IN",
      alternate_phone ?? null,
      address_line1 ?? null,
      address_line2 ?? null,
      city ?? null,
      district ?? null,
      state ?? null,
      postal_code ?? null,
      notes ?? null,
      updatedBy,
      uuid,
    ],
  );

  return rows[0] ?? null;
}

async function deleteBrokerByUuid(uuid, updatedBy = null) {
  const { rows } = await query(
    `UPDATE brokers
     SET
       deleted_at = NOW(),
       updated_by = $1,
       updated_at = NOW()
     WHERE uuid = $2
       AND deleted_at IS NULL
     RETURNING id, uuid, name, phone, deleted_at`,
    [updatedBy, uuid],
  );

  return rows[0] ?? null;
}

async function getAllBrokers() {
  const result = await query(`
    SELECT
      id,
      uuid,
      full_name AS name,
      phone,
      email
    FROM users
    WHERE role = 'broker'
      AND is_active = TRUE
      AND deleted_at IS NULL
    ORDER BY full_name ASC
  `);

  return result.rows;
}

module.exports = {
  createBroker,
  getBrokers,
  getBrokerByUuid,
  updateBrokerByUuid,
  deleteBrokerByUuid,
  getAllBrokers,
};
