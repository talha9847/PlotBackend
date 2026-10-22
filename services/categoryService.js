const { query } = require("../config/db");

const SORT_FIELDS = {
  name: "name",
  is_active: "is_active",
  isActive: "is_active",
  created_at: "created_at",
  updated_at: "updated_at",
};

const CATEGORY_COLUMNS = `
  id,
  uuid,
  name,
  description,
  is_active,
  created_by,
  created_at,
  updated_at
`;

/**
 * Create a transaction category
 */
const createCategory = async (data, createdBy = null) => {
  const { name, description = null, is_active = data.isActive ?? true } = data;

  const result = await query(
    `INSERT INTO transaction_categories (
      name,
      description,
      is_active,
      created_by
    )
    VALUES ($1, $2, $3, $4)
    RETURNING ${CATEGORY_COLUMNS}`,
    [name.trim(), description?.trim() || null, is_active, createdBy],
  );

  return result.rows[0];
};

/**
 * Get categories with pagination, search, filters and sorting
 */
const getCategories = async ({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
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

  // Search by category name or description
  if (String(search).trim()) {
    values.push(`%${String(search).trim()}%`);
    const p = `$${values.length}`;

    conditions.push(`(
      name ILIKE ${p}
      OR COALESCE(description, '') ILIKE ${p}
    )`);
  }

  // Filter by active/inactive status
  if (isActive !== undefined && isActive !== "") {
    const activeValue =
      typeof isActive === "boolean" ? isActive : isActive === "true";

    addFilter("is_active = ?", activeValue);
  }

  const whereClause = conditions.join(" AND ");

  // Count matching records for pagination
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM transaction_categories
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total;
  const totalPages = Math.ceil(total / limit);

  // Fetch current page
  const dataValues = [...values, limit, offset];

  const result = await query(
    `SELECT ${CATEGORY_COLUMNS}
     FROM transaction_categories
     WHERE ${whereClause}
     ORDER BY ${orderColumn} ${orderDirection}, id DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    dataValues,
  );

  return {
    categories: result.rows,
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
 * Get a single category by UUID
 */
const getCategoryByUuid = async (uuid) => {
  const result = await query(
    `SELECT ${CATEGORY_COLUMNS}
     FROM transaction_categories
     WHERE uuid = $1
       AND deleted_at IS NULL`,
    [uuid],
  );

  return result.rows[0] || null;
};

/**
 * Update a category by UUID
 * Validation should be handled in the controller.
 */
const updateCategoryByUuid = async (uuid, data) => {
  const fieldMap = {
    name: "name",
    description: "description",
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

    let normalizedValue = value;

    if (column === "name") {
      normalizedValue = String(value).trim();
    } else if (column === "description") {
      normalizedValue =
        typeof value === "string" ? value.trim() || null : value;
    }

    values.push(normalizedValue);
    updates.push(`${column} = $${values.length}`);
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push("updated_at = NOW()");
  values.push(uuid);

  const result = await query(
    `UPDATE transaction_categories
     SET ${updates.join(", ")}
     WHERE uuid = $${values.length}
       AND deleted_at IS NULL
     RETURNING ${CATEGORY_COLUMNS}`,
    values,
  );

  return result.rows[0] || null;
};

/**
 * Change category active status
 */
const setCategoryActiveByUuid = async (uuid, isActive) => {
  const result = await query(
    `UPDATE transaction_categories
     SET is_active = $1,
         updated_at = NOW()
     WHERE uuid = $2
       AND deleted_at IS NULL
     RETURNING ${CATEGORY_COLUMNS}`,
    [isActive, uuid],
  );

  return result.rows[0] || null;
};

/**
 * Soft delete a category
 */
const deleteCategoryByUuid = async (uuid) => {
  const result = await query(
    `UPDATE transaction_categories
     SET deleted_at = NOW(),
         updated_at = NOW(),
         is_active = FALSE
     WHERE uuid = $1
       AND deleted_at IS NULL
     RETURNING uuid`,
    [uuid],
  );

  return result.rows[0] || null;
};

module.exports = {
  SORT_FIELDS,
  createCategory,
  getCategories,
  getCategoryByUuid,
  updateCategoryByUuid,
  setCategoryActiveByUuid,
  deleteCategoryByUuid,
};
