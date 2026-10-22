const { query } = require("../config/db");

const PARTY_TYPES = [
  "driver",
  "employee",
  "vendor",
  "supplier",
  "landlord",
  "customer",
  "broker",
  "other",
];

const SORT_FIELDS = {
  name: "name",
  phone: "phone",
  email: "email",
  party_type: "party_type",
  partyType: "party_type",
  is_active: "is_active",
  isActive: "is_active",
  created_at: "created_at",
  updated_at: "updated_at",
};

const PARTY_COLUMNS = `
  id,
  uuid,
  name,
  party_type,
  phone,
  email,
  address,
  notes,
  is_active,
  created_by,
  created_at,
  updated_at
`;

/**
 * Create a party
 */
const createParty = async (data, createdBy = null) => {
  const {
    name,
    party_type = data.partyType || "other",
    phone,
    email = null,
    address = null,
    notes = null,
    is_active = data.isActive ?? true,
  } = data;

  const result = await query(
    `INSERT INTO parties (
      name,
      party_type,
      phone,
      email,
      address,
      notes,
      is_active,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING ${PARTY_COLUMNS}`,
    [name, party_type, phone, email, address, notes, is_active, createdBy],
  );

  return result.rows[0];
};

/**
 * Get parties with pagination, search, filters and sorting
 */
const getParties = async ({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
  partyType = "",
  isActive,
} = {}) => {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

  const offset = (page - 1) * limit;
  const orderColumn = SORT_FIELDS[sortBy] || "created_at";
  const orderDirection =
    String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const conditions = ["deleted_at IS NULL"];
  const values = [];

  const addFilter = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };

  if (search.trim()) {
    values.push(`%${search.trim()}%`);
    const p = `$${values.length}`;

    conditions.push(`(
      name ILIKE ${p}
      OR phone ILIKE ${p}
      OR email ILIKE ${p}
      OR address ILIKE ${p}
      OR notes ILIKE ${p}
    )`);
  }

  if (partyType && PARTY_TYPES.includes(partyType)) {
    addFilter("party_type = ?", partyType);
  }

  if (isActive !== undefined && isActive !== "") {
    const activeValue =
      typeof isActive === "boolean" ? isActive : isActive === "true";

    addFilter("is_active = ?", activeValue);
  }

  const whereClause = conditions.join(" AND ");

  // Count matching records for pagination
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM parties
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total;
  const totalPages = Math.ceil(total / limit);

  // Fetch current page
  const dataValues = [...values, limit, offset];

  const result = await query(
    `SELECT ${PARTY_COLUMNS}
     FROM parties
     WHERE ${whereClause}
     ORDER BY ${orderColumn} ${orderDirection}, id DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    dataValues,
  );

  return {
    parties: result.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && total > 0,
    },
  };
};

/**
 * Get a single party by UUID
 */
const getPartyByUuid = async (uuid) => {
  const result = await query(
    `SELECT ${PARTY_COLUMNS}
     FROM parties
     WHERE uuid = $1
       AND deleted_at IS NULL`,
    [uuid],
  );

  return result.rows[0] || null;
};

/**
 * Update a party by UUID
 * Validation should be handled in the controller.
 */
const updatePartyByUuid = async (uuid, data) => {
  const fieldMap = {
    name: "name",
    party_type: "party_type",
    partyType: "party_type",
    phone: "phone",
    email: "email",
    address: "address",
    notes: "notes",
    is_active: "is_active",
    isActive: "is_active",
  };

  const updates = [];
  const values = [];
  const usedColumns = new Set();

  for (const [key, value] of Object.entries(data)) {
    const column = fieldMap[key];

    if (!column || usedColumns.has(column)) {
      continue;
    }

    usedColumns.add(column);
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push("updated_at = NOW()");
  values.push(uuid);

  const result = await query(
    `UPDATE parties
     SET ${updates.join(", ")}
     WHERE uuid = $${values.length}
       AND deleted_at IS NULL
     RETURNING ${PARTY_COLUMNS}`,
    values,
  );

  return result.rows[0] || null;
};

/**
 * Change party active status
 */
const setPartyActiveByUuid = async (uuid, isActive) => {
  const result = await query(
    `UPDATE parties
     SET is_active = $1,
         updated_at = NOW()
     WHERE uuid = $2
       AND deleted_at IS NULL
     RETURNING ${PARTY_COLUMNS}`,
    [isActive, uuid],
  );

  return result.rows[0] || null;
};

/**
 * Soft delete a party
 */
const deletePartyByUuid = async (uuid) => {
  const result = await query(
    `UPDATE parties
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE uuid = $1
       AND deleted_at IS NULL
     RETURNING uuid`,
    [uuid],
  );

  return result.rows[0] || null;
};

module.exports = {
  PARTY_TYPES,
  createParty,
  getParties,
  getPartyByUuid,
  updatePartyByUuid,
  setPartyActiveByUuid,
  deletePartyByUuid,
};
