const { pool, query } = require("../config/db");

const SORT_COLUMNS = {
  name: "name",
  phone: "phone",
  project: "project_name",
  plot: "plot",
  total: "total",
  paid: "paid",
  balance: "balance",
  status: "status",
  booking_date: "booking_date",
};

const CUSTOMER_ROWS_SQL = `
  WITH customer_rows AS (
    SELECT
      b.id AS id,
      c.id AS customer_id,
      c.uuid AS customer_uuid,
      b.id AS booking_id,
      b.uuid AS booking_uuid,
      b.booking_number,
      b.booking_date,
      pr.id AS project_id,
      pr.name AS project_name,
      l.name AS name,
      l.phone AS phone,
      p.id AS plot_id,
      p.plot_number AS plot,

      b.total_amount AS total,

      COALESCE(
        cp.remaining_balance,
        GREATEST(b.total_amount - b.booking_amount, 0)
      ) AS balance,

      GREATEST(
        b.total_amount -
        COALESCE(
          cp.remaining_balance,
          GREATEST(b.total_amount - b.booking_amount, 0)
        ),
        0
      ) AS paid,

      CASE
        WHEN cp.status = 'cancelled' THEN 'Cancelled'

        WHEN COALESCE(
          cp.remaining_balance,
          GREATEST(b.total_amount - b.booking_amount, 0)
        ) <= 0 THEN 'Paid'

        WHEN COALESCE(payment_schedule.has_overdue, FALSE)
          THEN 'Overdue'

        WHEN COALESCE(payment_schedule.due_soon, FALSE)
          THEN 'Due soon'

        ELSE 'On track'
      END AS status

    FROM customers c

    INNER JOIN leads l
      ON l.id = c.lead_id
      AND l.deleted_at IS NULL

    INNER JOIN bookings b
      ON b.customer_id = c.id
      AND b.status NOT IN ('cancelled', 'refunded')

    INNER JOIN projects pr
      ON pr.id = b.project_id
      AND pr.deleted_at IS NULL

    INNER JOIN plots p
      ON p.id = b.plot_id
      AND p.deleted_at IS NULL

    LEFT JOIN customer_plans cp
      ON cp.booking_id = b.id

    LEFT JOIN LATERAL (
      SELECT
        BOOL_OR(
          i.due_date < CURRENT_DATE
          AND i.status IN ('pending', 'partially_paid', 'overdue')
          AND i.amount_paid < i.amount_due + i.late_fee
        ) AS has_overdue,

        BOOL_OR(
          i.due_date BETWEEN CURRENT_DATE
            AND CURRENT_DATE + 7
          AND i.status IN ('pending', 'partially_paid', 'overdue')
          AND i.amount_paid < i.amount_due + i.late_fee
        ) AS due_soon

      FROM installments i
      WHERE i.customer_plan_id = cp.id
    ) payment_schedule ON TRUE
  )
`;

function buildFilters({ search, projectId, status }) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search.trim()}%`);
    const index = params.length;

    conditions.push(`
      (
        name ILIKE $${index}
        OR phone ILIKE $${index}
        OR plot ILIKE $${index}
        OR project_name ILIKE $${index}
        OR booking_number ILIKE $${index}
      )
    `);
  }

  if (projectId) {
    params.push(projectId);
    conditions.push(`project_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function getCustomers({
  page = 1,
  limit = 10,
  search = "",
  projectId = null,
  status = null,
  sortBy = "booking_date",
  sortOrder = "desc",
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const offset = (safePage - 1) * safeLimit;

  const sortColumn = SORT_COLUMNS[sortBy] || SORT_COLUMNS.booking_date;

  const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  const { where, params } = buildFilters({
    search,
    projectId,
    status,
  });

  const countQuery = `
    ${CUSTOMER_ROWS_SQL}
    SELECT COUNT(*)::int AS total
    FROM customer_rows
    ${where}
  `;

  const rowsQuery = `
    ${CUSTOMER_ROWS_SQL}
    SELECT *
    FROM customer_rows
    ${where}
    ORDER BY ${sortColumn} ${direction} NULLS LAST, id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const statsQuery = `
    ${CUSTOMER_ROWS_SQL}
    SELECT
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COALESCE(SUM(total), 0) AS total_value,
      COALESCE(SUM(paid), 0) AS collected,
      COALESCE(SUM(balance), 0) AS outstanding,
      CASE
        WHEN COALESCE(SUM(total), 0) = 0 THEN 0
        ELSE ROUND(
          COALESCE(SUM(paid), 0) * 100.0 / SUM(total)
        )::int
      END AS collected_percentage
    FROM customer_rows
    ${where}
  `;

  const [countResult, rowsResult, statsResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(rowsQuery, [...params, safeLimit, offset]),
    pool.query(statsQuery, params),
  ]);

  const total = countResult.rows[0].total;

  return {
    customers: rowsResult.rows,
    stats: statsResult.rows[0],
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      hasNextPage: safePage * safeLimit < total,
      hasPrevPage: safePage > 1,
    },
  };
}

module.exports = { getCustomers };
