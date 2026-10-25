const { query, pool } = require("../config/db");

// 1. Project dropdown: only the fields needed by the frontend
const getProjects = async () => {
  const result = await query(
    `
      SELECT id, uuid, name
      FROM projects
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `,
  );

  return result.rows;
};

// Internal helper: find an active project by UUID
const findProjectByUuid = async (uuid) => {
  const result = await query(
    `
      SELECT id, uuid, name
      FROM projects
      WHERE uuid = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [uuid],
  );

  return result.rows[0] || null;
};

// 2. Statistics for one project's plots
const getPlotStats = async (uuid) => {
  const project = await findProjectByUuid(uuid);

  if (!project) {
    return null;
  }

  const result = await query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE status = 'available'
        )::int AS available,
        COUNT(*) FILTER (
          WHERE status IN ('reserved', 'booked')
        )::int AS booked,
        COUNT(*) FILTER (
          WHERE status = 'sold'
        )::int AS sold
      FROM plots
      WHERE project_id = $1
        AND deleted_at IS NULL
    `,
    [project.id],
  );

  return {
    project: {
      id: project.id,
      uuid: project.uuid,
      name: project.name,
    },
    stats: result.rows[0],
  };
};

// 3. Plot details for one project UUID

const getPlotsByProjectUuid = async (uuid, options = {}) => {
  const project = await findProjectByUuid(uuid);

  if (!project) {
    return null;
  }

  const {
    page = 1,
    limit = 10,
    search = "",
    sortBy = "plot_number",
    sortOrder = "asc",
    status = "",
    plotType = "",
  } = options;

  // Pagination
  const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
  const offset = (currentPage - 1) * pageSize;

  const SORT_COLUMNS = {
    id: "p.id",
    plot_number: "p.plot_number",
    plot_type: "p.plot_type",
    price: "p.base_price",
    status: "p.status",
    created_at: "p.created_at",
    updated_at: "p.updated_at",
  };

  const safeSortBy = SORT_COLUMNS[sortBy] ? sortBy : "plot_number";
  const safeSortOrder =
    String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";

  const VALID_STATUSES = [
    "available",
    "reserved",
    "booked",
    "sold",
    "blocked",
    "under_development",
  ];

  const VALID_PLOT_TYPES = [
    "residential",
    "commercial",
    "industrial",
    "agricultural",
    "other",
  ];

  // Build parameterized filters
  const conditions = ["p.project_id = $1", "p.deleted_at IS NULL"];

  const params = [project.id];

  if (String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const searchParam = `$${params.length}`;

    conditions.push(`(
      p.plot_number ILIKE ${searchParam}
      OR p.plot_type ILIKE ${searchParam}
      OR p.status ILIKE ${searchParam}
      OR COALESCE(p.notes, '') ILIKE ${searchParam}
    )`);
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error("Invalid plot status filter");
    }

    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  if (plotType) {
    if (!VALID_PLOT_TYPES.includes(plotType)) {
      throw new Error("Invalid plot type filter");
    }

    params.push(plotType);
    conditions.push(`p.plot_type = $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");

  // Count matching plots before applying pagination
  const countResult = await query(
    `
      SELECT COUNT(*)::INTEGER AS total
      FROM plots p
      WHERE ${whereClause}
    `,
    params,
  );

  const total = Number(countResult.rows[0]?.total ?? 0);

  // Fetch current page
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;

  const result = await query(
    `
      SELECT
        p.id,
        p.uuid,
        p.project_id AS "projectId",
        p.plot_number AS "plotNo",
        p.plot_type AS "plotType",
        p.base_price AS price,
        p.status,
        p.length,
        p.breadth,
        p.dimension,
        p.area,
        p.facing,
        p.is_corner AS "isCorner",
        p.boundary_wall AS "boundaryWall",
        p.road_width AS "roadWidth",
        p.notes,
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",
        l.id AS "leadId",
        l.uuid AS "leadUuid",
        l.name AS "leadName",
        l.phone AS "leadPhone"
      FROM plots p
      LEFT JOIN LATERAL (
        SELECT
          l.id,
          l.uuid,
          l.name,
          l.phone
        FROM leads l
        WHERE l.plot_id = p.id
          AND l.deleted_at IS NULL
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ) l ON TRUE
      WHERE ${whereClause}
      ORDER BY
        ${SORT_COLUMNS[safeSortBy]} ${safeSortOrder} NULLS LAST,
        p.id ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    [...params, pageSize, offset],
  );

  const totalPages = Math.ceil(total / pageSize);

  return {
    project: {
      id: project.id,
      uuid: project.uuid,
      name: project.name,
    },
    plots: result.rows,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1 && total > 0,
    },
  };
};

async function getPlotsDropdown({ projectId, search }) {
  const queryString = `
    SELECT
      p.id,
      p.uuid,
      p.plot_number AS name,
      p.status
    FROM plots p
    INNER JOIN projects pr
      ON pr.id = p.project_id
    WHERE p.deleted_at IS NULL
      AND pr.deleted_at IS NULL
      AND p.status <> 'booked'
      AND ($1::bigint IS NULL OR p.project_id = $1)
      AND (
        $2::text IS NULL
        OR p.plot_number ILIKE '%' || $2 || '%'
      )
    ORDER BY
      CASE
        WHEN LOWER(p.plot_number) = LOWER($2) THEN 0
        ELSE 1
      END,
      p.plot_number ASC
    LIMIT 10;
  `;

  const result = await query(queryString, [
    projectId || null,
    search?.trim() || null,
  ]);

  return result.rows;
}

async function getPlotsDropdown2({ projectId, search }) {
  const queryString = `
    SELECT
      p.id,
      p.uuid,
      p.plot_number AS name,
      p.status
    FROM plots p
    INNER JOIN projects pr
      ON pr.id = p.project_id
    WHERE p.deleted_at IS NULL
      AND pr.deleted_at IS NULL
      AND p.status='booked'
      AND ($1::bigint IS NULL OR p.project_id = $1)
      AND (
        $2::text IS NULL
        OR p.plot_number ILIKE '%' || $2 || '%'
      )
    ORDER BY
      CASE
        WHEN LOWER(p.plot_number) = LOWER($2) THEN 0
        ELSE 1
      END,
      p.plot_number ASC
    LIMIT 10;
  `;

  const result = await query(queryString, [
    projectId || null,
    search?.trim() || null,
  ]);

  return result.rows;
}

// 4. Update a single plot's editable attributes.
const EDITABLE_COLUMNS = new Set([
  "plot_type",
  "base_price",
  "length",
  "breadth",
  "dimension",
  "status",
  "facing",
  "is_corner",
  "boundary_wall",
  "road_width",
  "notes",
]);

const createServiceError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const updatePlotByUuid = async (uuid, data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createServiceError("A plot payload is required.");
  }

  const entries = Object.entries(data).filter(([key]) =>
    EDITABLE_COLUMNS.has(key),
  );

  if (entries.length === 0) {
    throw createServiceError("No editable plot fields were provided.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query(
      `
        SELECT id, length, breadth, status
        FROM plots
        WHERE uuid = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [uuid],
    );

    if (currentResult.rowCount === 0) {
      throw createServiceError("Plot not found.", 404);
    }

    const current = currentResult.rows[0];

    const mergedLength = Object.hasOwn(data, "length")
      ? data.length
      : current.length;
    const mergedBreadth = Object.hasOwn(data, "breadth")
      ? data.breadth
      : current.breadth;

    const hasLength = mergedLength !== null && mergedLength !== undefined;
    const hasBreadth = mergedBreadth !== null && mergedBreadth !== undefined;

    if (hasLength !== hasBreadth) {
      throw createServiceError(
        "Length and breadth must both be provided or both be empty.",
      );
    }

    // Releasing a plot must not orphan an active booking.
    if (data.status === "available" && current.status !== "available") {
      const bookingResult = await client.query(
        `
          SELECT 1
          FROM bookings
          WHERE plot_id = $1
            AND status NOT IN ('cancelled', 'refunded')
          LIMIT 1
        `,
        [current.id],
      );

      if (bookingResult.rowCount > 0) {
        throw createServiceError(
          "This plot has an active booking. Cancel the booking before marking the plot available.",
          409,
        );
      }
    }

    const values = [];
    const assignments = [];

    for (const [column, value] of entries) {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }

    values.push(uuid);

    const result = await client.query(
      `
        UPDATE plots
        SET ${assignments.join(", ")}
        WHERE uuid = $${values.length}
          AND deleted_at IS NULL
        RETURNING
          id,
          uuid,
          project_id AS "projectId",
          plot_number AS "plotNo",
          plot_type AS "plotType",
          base_price AS price,
          status,
          length,
          breadth,
          dimension,
          area,
          facing,
          is_corner AS "isCorner",
          boundary_wall AS "boundaryWall",
          road_width AS "roadWidth",
          notes,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      values,
    );

    await client.query("COMMIT");

    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getProjects,
  getPlotStats,
  getPlotsByProjectUuid,
  getPlotsDropdown,
  getPlotsDropdown2,
  updatePlotByUuid,
};
