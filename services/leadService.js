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
  lead_type: "lead_type",
  company_name: "company_name",
  city: "city",
  state: "state",
  created_at: "created_at",
  updated_at: "updated_at",
};

async function createLead(data, createdBy = null) {
  const {
    name,
    phone,
    alternate_phone,
    email,
    brokerId,
    lead_type = "individual",
    company_name,
    address_line1,
    address_line2,
    city,
    district,
    state,
    postal_code,
    country_code = "IN",
    notes,
    projectId,
    plotId,
  } = data;

  const result = await query(
    `INSERT INTO leads (
      name,
      phone,
      alternate_phone,
      email,
      lead_type,
      company_name,
      address_line1,
      address_line2,
      city,
      district,
      state,
      postal_code,
      country_code,
      notes,
      created_by,
      broker_id,
      project_id,
      plot_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,$17,$18
    )
    RETURNING
      id, uuid, name, phone, alternate_phone, email,
      lead_type, company_name, address_line1,
      address_line2, city, district, state, postal_code,
      country_code, notes,
      created_by, created_at,broker_id,project_id,plot_id, updated_at`,
    [
      name,
      phone,
      alternate_phone || null,
      email || null,
      lead_type,
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
      brokerId,
      projectId,
      plotId,
    ],
  );

  return result.rows[0];
}

async function getLeads({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
  leadType = "",
}) {
  const offset = (page - 1) * limit;

  const sortColumns = {
    name: "l.name",
    created_at: "l.created_at",
    updated_at: "l.updated_at",
    lead_type: "l.lead_type",
    broker_name: "u.full_name",
    project_name: "pr.name",
    plot_number: "p.plot_number",
  };

  const sortColumn = sortColumns[sortBy] || "l.created_at";
  const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const conditions = ["l.deleted_at IS NULL"];
  const values = [];

  if (search.trim()) {
    values.push(`%${search.trim()}%`);
    const index = values.length;

    conditions.push(`(
      l.name ILIKE $${index}
      OR l.phone ILIKE $${index}
      OR COALESCE(l.alternate_phone, '') ILIKE $${index}
      OR COALESCE(l.email, '') ILIKE $${index}
      OR COALESCE(l.company_name, '') ILIKE $${index}
      OR COALESCE(l.city, '') ILIKE $${index}
      OR COALESCE(l.district, '') ILIKE $${index}
      OR COALESCE(l.state, '') ILIKE $${index}
      OR COALESCE(l.postal_code, '') ILIKE $${index}
      OR COALESCE(u.full_name, '') ILIKE $${index}
      OR COALESCE(pr.name, '') ILIKE $${index}
      OR COALESCE(p.plot_number, '') ILIKE $${index}
    )`);
  }

  if (leadType) {
    values.push(leadType);
    conditions.push(`l.lead_type = $${values.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const joins = `
    FROM leads l

    LEFT JOIN users u
      ON u.id = l.broker_id
      AND u.deleted_at IS NULL

    LEFT JOIN projects pr
      ON pr.id = l.project_id
      AND pr.deleted_at IS NULL

    LEFT JOIN plots p
      ON p.id = l.plot_id
      AND p.deleted_at IS NULL
  `;

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     ${joins}
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total;
  const totalPages = Math.ceil(total / limit);

  const dataValues = [...values, limit, offset];
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;

  const result = await query(
    `SELECT
       l.id,
       l.uuid,
       l.name,
       l.phone,
       l.alternate_phone,
       l.email,
       l.lead_type,
       l.company_name,

       l.project_id,
       pr.name AS project_name,

       l.plot_id,
       p.plot_number AS plot_number,
       p.status AS plot_status,

       l.address_line1,
       l.address_line2,
       l.city,
       l.district,
       l.state,
       l.postal_code,
       l.country_code,
       l.notes,

       l.created_by,
       l.created_at,
       l.updated_at,

       l.broker_id,
       u.full_name AS broker_name

     ${joins}
     WHERE ${whereClause}
     ORDER BY ${sortColumn} ${direction}, l.id DESC
     LIMIT $${limitIndex}
     OFFSET $${offsetIndex}`,
    dataValues,
  );

  return {
    leads: result.rows,
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

async function getLeadByUuid(uuid) {
  const result = await query(
    `SELECT
       id, uuid, name, phone, alternate_phone, email,
       lead_type, company_name, address_line1,
       address_line2, city, district, state, postal_code,
       country_code, notes,
       created_by, created_at, updated_at
     FROM leads
     WHERE uuid = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [uuid],
  );

  return result.rows[0] || null;
}

const updateLeadByUuid = async (uuid, data, updatedBy) => {
  const fieldMap = {
    name: "name",
    phone: "phone",
    email: "email",
    lead_type: "lead_type",
    country_code: "country_code",
    alternate_phone: "alternate_phone",
    company_name: "company_name",
    address_line1: "address_line1",
    address_line2: "address_line2",
    city: "city",
    district: "district",
    state: "state",
    postal_code: "postal_code",
    notes: "notes",
    brokerId: "broker_id",
    projectId: "project_id",
    plotId: "plot_id",
  };

  const updates = [];
  const values = [];
  let index = 1;

  for (const [key, column] of Object.entries(fieldMap)) {
    if (
      Object.hasOwn(data, key) &&
      data[key] !== null &&
      data[key] !== undefined
    ) {
      updates.push(`${column} = $${index++}`);
      values.push(data[key]);
    }
  }

  if (updatedBy !== null && updatedBy !== undefined) {
    updates.push(`updated_by = $${index++}`);
    values.push(updatedBy);
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push("updated_at = NOW()");
  values.push(uuid);

  const { rows } = await query(
    `UPDATE leads
     SET ${updates.join(", ")}
     WHERE uuid = $${index}
       AND deleted_at IS NULL
     RETURNING *`,
    values,
  );

  return rows[0] ?? null;
};
async function getLeadsDropdown({ search }) {
  const queryString = `
    SELECT
      l.id,
      l.uuid,
      l.name,
      l.phone,
      l.broker_id AS "brokerId",
      u.full_name AS "brokerName"
    FROM leads l
    LEFT JOIN users u
      ON u.id = l.broker_id
      AND u.deleted_at IS NULL
    WHERE l.deleted_at IS NULL
      AND (
        $1::text IS NULL
        OR l.name ILIKE '%' || $1 || '%'
        OR l.phone ILIKE '%' || $1 || '%'
        OR u.full_name ILIKE '%' || $1 || '%'
      )
    ORDER BY
      CASE
        WHEN LOWER(l.name) = LOWER($1) THEN 0
        ELSE 1
      END,
      l.name ASC
    LIMIT 10;
  `;

  const result = await query(queryString, [search?.trim() || null]);

  return result.rows;
}

module.exports = {
  createLead,
  getLeads,
  getLeadByUuid,
  CUSTOMER_TYPES,
  updateLeadByUuid,
  getLeadsDropdown,
};
