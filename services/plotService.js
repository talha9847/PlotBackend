const { query } = require("../config/db");

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
const getPlotsByProjectUuid = async (uuid) => {
  const project = await findProjectByUuid(uuid);

  if (!project) {
    return null;
  }

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
        p.notes,
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM plots p
      WHERE p.project_id = $1
        AND p.deleted_at IS NULL
      ORDER BY p.plot_number ASC
    `,
    [project.id],
  );

  return {
    project: {
      id: project.id,
      uuid: project.uuid,
      name: project.name,
    },
    plots: result.rows,
  };
};

module.exports = {
  getProjects,
  getPlotStats,
  getPlotsByProjectUuid,
};
