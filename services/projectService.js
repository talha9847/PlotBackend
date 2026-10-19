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

async function manageProjectPlots({
  project_id,
  action,
  count,
  createdBy = null,
}) {
  const client = await pool.connect();

  try {
    // Validate the request before opening a transaction.
    if (!project_id) {
      throw new ProjectServiceError("Project ID is required.", 400);
    }

    if (!["add", "delete"].includes(action)) {
      throw new ProjectServiceError(
        'Action must be either "add" or "delete".',
        400,
      );
    }

    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new ProjectServiceError(
        "Plot count must be a positive whole number.",
        400,
      );
    }

    await client.query("BEGIN");

    // Lock the project so simultaneous plot updates cannot overwrite each other.
    const projectResult = await client.query(
      `
        SELECT id, uuid, name, plots
        FROM projects
        WHERE id::text = $1 OR uuid::text = $1
        FOR UPDATE
      `,
      [String(project_id)],
    );

    if (projectResult.rowCount === 0) {
      throw new ProjectServiceError("Project not found.", 404);
    }

    const project = projectResult.rows[0];
    const currentPlots = Number(project.plots || 0);

    if (action === "add") {
      // Find the highest existing numeric suffix to avoid reusing plot numbers.
      const maxResult = await client.query(
        `
          SELECT COALESCE(
            MAX(substring(plot_number FROM '([0-9]+)$')::bigint),
            0
          ) AS max_number
          FROM plots
          WHERE project_id = $1
        `,
        [project.id],
      );

      const maxNumber = Number(maxResult.rows[0].max_number);

      if (
        !Number.isSafeInteger(maxNumber) ||
        !Number.isSafeInteger(maxNumber + count)
      ) {
        throw new ProjectServiceError(
          "The requested plot numbers exceed the supported range.",
          400,
        );
      }

      const prefix = generatePlotPrefix(project.name);

      const plotNumbers = Array.from(
        { length: count },
        (_, index) =>
          `${prefix}-${String(maxNumber + index + 1).padStart(3, "0")}`,
      );

      // Insert individual plot records.
      await client.query(
        `
          INSERT INTO plots (
            project_id,
            plot_number,
            created_by
          )
          SELECT $1, generated.plot_number, $3
          FROM unnest($2::varchar[]) AS generated(plot_number)
        `,
        [project.id, plotNumbers, createdBy],
      );

      // Keep the project's stored plot count synchronized.
      const updatedProject = await client.query(
        `
          UPDATE projects
          SET plots = plots + $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, uuid, name, plots
        `,
        [project.id, count],
      );

      await client.query("COMMIT");

      return {
        action: "add",
        requested: count,
        affected: count,
        project: updatedProject.rows[0],
        plot_numbers: plotNumbers,
      };
    }

    // DELETE FLOW
    // Assumes plots.status stores values such as available, booked, and sold.
    // Select the highest-numbered available plots first.
    const deletableResult = await client.query(
      `
        SELECT id, plot_number
        FROM plots
        WHERE project_id = $1
          AND LOWER(COALESCE(status, 'available'))
              NOT IN ('booked', 'sold')
        ORDER BY
          substring(plot_number FROM '([0-9]+)$')::bigint DESC NULLS LAST,
          plot_number DESC
        LIMIT $2
        FOR UPDATE
      `,
      [project.id, count],
    );

    if (deletableResult.rowCount < count) {
      throw new ProjectServiceError(
        `Only ${deletableResult.rowCount} plots can be deleted safely. Requested: ${count}. Booked or sold plots cannot be deleted.`,
        409,
      );
    }

    const plotIds = deletableResult.rows.map((plot) => plot.id);

    const deletedResult = await client.query(
      `
        DELETE FROM plots
        WHERE project_id = $1
          AND id = ANY($2)
        RETURNING id, plot_number
      `,
      [project.id, plotIds],
    );

    const deletedCount = deletedResult.rowCount;

    if (deletedCount !== count) {
      throw new ProjectServiceError(
        "The number of deleted plots did not match the requested count.",
        409,
      );
    }

    const updatedProject = await client.query(
      `
        UPDATE projects
        SET plots = plots - $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, uuid, name, plots
      `,
      [project.id, deletedCount],
    );

    await client.query("COMMIT");

    return {
      action: "delete",
      requested: count,
      affected: deletedCount,
      project: updatedProject.rows[0],
      deleted_plots: deletedResult.rows.map((plot) => plot.plot_number),
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof ProjectServiceError) {
      throw error;
    }

    if (error.code === "23505") {
      throw new ProjectServiceError(
        "A plot with this number already exists.",
        409,
      );
    }

    if (error.code === "23514") {
      throw new ProjectServiceError(
        "One or more plot fields have invalid values.",
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
  manageProjectPlots,
};
