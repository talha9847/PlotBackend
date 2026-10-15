const { query } = require("../config/db");

const CUSTOMER_TYPES = [
  "individual",
  "company",
  "partnership",
  "trust",
  "other",
];

// Only these columns can be used for sorting.
// Never insert a user-provided column name directly into SQL.
const SORT_COLUMNS = {
  name: "name",
  phone: "phone",
  email: "email",
  customer_type: "customer_type",
  company_name: "company_name",
  city: "city",
  state: "state",
  created_at: "created_at",
  updated_at: "updated_at",
};

async function createCustomer(data, createdBy = null) {
  const {
    name,
    phone,
    alternate_phone,
    email,
    customer_type = "individual",
    company_name,
    address_line1,
    address_line2,
    city,
    district,
    state,
    postal_code,
    country_code = "IN",
    notes,
  } = data;

  const result = await query(
    `INSERT INTO customers (
      name,
      phone,
      alternate_phone,
      email,
      customer_type,
      company_name,
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
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15
    )
    RETURNING
      id, uuid, name, phone, alternate_phone, email,
      customer_type, company_name, address_line1,
      address_line2, city, district, state, postal_code,
      country_code, notes,
      created_by, created_at, updated_at`,
    [
      name,
      phone,
      alternate_phone || null,
      email || null,
      customer_type,
      company_name || null,
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

  return result.rows[0];
}

async function getCustomers({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
  customerType = "",
}) {
  const offset = (page - 1) * limit;

  // Whitelist sort columns and direction.
  const sortColumn = SORT_COLUMNS[sortBy] || "created_at";
  const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const conditions = ["deleted_at IS NULL"];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    const index = values.length;

    conditions.push(`(
      name ILIKE $${index}
      OR phone ILIKE $${index}
      OR COALESCE(alternate_phone, '') ILIKE $${index}
      OR COALESCE(email, '') ILIKE $${index}
      OR COALESCE(company_name, '') ILIKE $${index}
      OR COALESCE(city, '') ILIKE $${index}
      OR COALESCE(district, '') ILIKE $${index}
      OR COALESCE(state, '') ILIKE $${index}
      OR COALESCE(postal_code, '') ILIKE $${index}
    )`);
  }

  if (customerType) {
    values.push(customerType);
    conditions.push(`customer_type = $${values.length}`);
  }

  const whereClause = conditions.join(" AND ");

  // Count uses exactly the same filters as the data query.
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM customers
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total;
  const totalPages = Math.ceil(total / limit);

  const dataValues = [...values, limit, offset];

  const result = await query(
    `SELECT
       id, uuid, name, phone, alternate_phone, email,
       customer_type, company_name, address_line1,
       address_line2, city, district, state, postal_code,
       country_code, notes,
       created_by, created_at, updated_at
     FROM customers
     WHERE ${whereClause}
     ORDER BY ${sortColumn} ${direction}, id DESC
     LIMIT $${dataValues.length - 1}
     OFFSET $${dataValues.length}`,
    dataValues,
  );

  return {
    customers: result.rows,
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

async function getCustomerByUuid(uuid) {
  const result = await query(
    `SELECT
       id, uuid, name, phone, alternate_phone, email,
       customer_type, company_name, address_line1,
       address_line2, city, district, state, postal_code,
       country_code, notes,
       created_by, created_at, updated_at
     FROM customers
     WHERE uuid = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [uuid],
  );

  return result.rows[0] || null;
}

const updateCustomerByUuid = async (uuid, data, updatedBy) => {
  const {
    name,
    phone,
    email,
    customer_type,
    country_code,
    alternate_phone,
    company_name,
    address_line1,
    address_line2,
    city,
    district,
    state,
    postal_code,
    notes,
  } = data;

  const { rows } = await query(
    `UPDATE customers
     SET
       name = $1,
       phone = $2,
       email = $3,
       customer_type = $4,
       country_code = $5,
       alternate_phone = $6,
       company_name = $7,
       address_line1 = $8,
       address_line2 = $9,
       city = $10,
       district = $11,
       state = $12,
       postal_code = $13,
       notes = $14,
       updated_by = $15,
       updated_at = NOW()
     WHERE uuid = $16
       AND deleted_at IS NULL
     RETURNING *`,
    [
      name,
      phone,
      email ?? null,
      customer_type,
      country_code ?? "+91",
      alternate_phone ?? null,
      company_name ?? null,
      address_line1 ?? null,
      address_line2 ?? null,
      city ?? null,
      district ?? null,
      state ?? null,
      postal_code ?? null,
      notes ?? null,
      updatedBy ?? null,
      uuid,
    ],
  );

  return rows[0] ?? null;
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerByUuid,
  CUSTOMER_TYPES,
  updateCustomerByUuid,
};
