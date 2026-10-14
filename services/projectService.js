const { pool } = require("../config/db");
const { query } = require("../config/db");

class ProjectServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ProjectServiceError";
    this.statusCode = statusCode;
  }
}

// Generate initials: "Green Valley" -> "GV"
function generatePlotPrefix(projectName) {
  const words = projectName.trim().split(/\s+/);

  let prefix;

  if (words.length > 1) {
    prefix = words
      .map((word) => word[0])
      .join("")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 10);
  } else {
    prefix = projectName
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 3);
  }

  return prefix || "PLT";
}

async function createProject(data, createdBy = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const projectQuery = `
      INSERT INTO projects (
        name,
        plots,
        project_type,
        status,
        address_line1,
        address_line2,
        city,
        district,
        state,
        postal_code,
        total_area,
        area_unit,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13
      )
      RETURNING
        id,
        uuid,
        name,
        plots,
        project_type,
        status,
        address_line1,
        address_line2,
        city,
        district,
        state,
        postal_code,
        total_area,
        area_unit,
        created_by,
        created_at,
        updated_at
    `;

    const projectValues = [
      data.name.trim(),
      data.plots,
      data.project_type,
      data.status,
      data.address_line1?.trim() || null,
      data.address_line2?.trim() || null,
      data.city?.trim() || null,
      data.district?.trim() || null,
      data.state?.trim() || null,
      data.postal_code?.trim() || null,
      data.total_area ?? null,
      data.area_unit,
      createdBy,
    ];

    const projectResult = await client.query(projectQuery, projectValues);

    const project = projectResult.rows[0];

    // Generate plot numbers, e.g. GV-101, GV-102...
    const prefix = generatePlotPrefix(project.name);
    const startNumber = 1;

    const plotNumbers = Array.from(
      { length: project.plots },
      (_, index) => `${prefix}-${String(startNumber + index).padStart(3, "0")}`,
    );

    // Bulk insert all plots in a single query.
    if (plotNumbers.length > 0) {
      await client.query(
        `
          INSERT INTO plots (
            project_id,
            plot_number,
            created_by
          )
          SELECT
            $1,
            plot_number,
            $3
          FROM unnest($2::varchar[]) AS generated(plot_number)
        `,
        [project.id, plotNumbers, createdBy],
      );
    }

    await client.query("COMMIT");

    return {
      ...project,
      generated_plots: plotNumbers.length,
      plot_prefix: prefix,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      throw new ProjectServiceError(
        "A project or plot with a conflicting unique value already exists.",
        409,
      );
    }

    if (error.code === "23514") {
      throw new ProjectServiceError(
        "One or more project or plot fields have invalid values.",
        400,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getProjects() {
  try {
    const result = await query(`
    SELECT
      p.id,
      p.uuid,
      p.name,
      p.plots,
      p.project_type,
      p.status,
      p.address_line1,
      p.address_line2,
      p.city,
      p.district,
      p.state,
      p.postal_code,
      p.total_area,
      p.area_unit,
      p.created_by,
      p.created_at,
      p.updated_at,

      COALESCE(plot_counts.booked, 0)::INTEGER AS booked,
      COALESCE(plot_counts.sold, 0)::INTEGER AS sold,

      GREATEST(
        p.plots - COALESCE(plot_counts.booked, 0)
                - COALESCE(plot_counts.sold, 0),
        0
      )::INTEGER AS available

    FROM projects p

    LEFT JOIN (
      SELECT
        project_id,
        COUNT(*) FILTER (
          WHERE status IN ('reserved', 'booked')
        ) AS booked,
        COUNT(*) FILTER (
          WHERE status = 'sold'
        ) AS sold
      FROM plots
      WHERE deleted_at IS NULL
      GROUP BY project_id
    ) AS plot_counts ON plot_counts.project_id = p.id

    WHERE p.deleted_at IS NULL

    ORDER BY p.created_at DESC, p.id DESC
  `);

    return result.rows;
  } catch (error) {
    console.log(error);
  }
}

async function getProjectStats() {
  const result = await query(`
    SELECT
      COUNT(*)::INTEGER AS total_projects,
      COALESCE(SUM(p.plots), 0)::BIGINT AS total_plots,
      COALESCE(SUM(plot_counts.booked), 0)::BIGINT AS booked_plots,
      COALESCE(SUM(plot_counts.sold), 0)::BIGINT AS sold_plots,
      GREATEST(
        COALESCE(SUM(p.plots), 0)
        - COALESCE(SUM(plot_counts.booked), 0)
        - COALESCE(SUM(plot_counts.sold), 0),
        0
      )::BIGINT AS available_plots

    FROM projects p

    LEFT JOIN (
      SELECT
        project_id,
        COUNT(*) FILTER (
          WHERE status IN ('reserved', 'booked')
        ) AS booked,
        COUNT(*) FILTER (
          WHERE status = 'sold'
        ) AS sold
      FROM plots
      WHERE deleted_at IS NULL
      GROUP BY project_id
    ) AS plot_counts ON plot_counts.project_id = p.id

    WHERE p.deleted_at IS NULL
  `);

  return result.rows[0];
}

module.exports = {
  createProject,
  ProjectServiceError,
  getProjects,
  getProjectStats,
};
