const { pool, query } = require("../config/db");
const SORT_COLUMNS = {
  customer_name: "customer_name",
  project_name: "project_name",
  plot_number: "plot_number",
  installment_number: "installment_number",
  due_date: "due_date",
  amount_due: "amount_due",
  amount_paid: "amount_paid",
  remaining: "remaining",
  status: "status",
};

const INSTALLMENT_ROWS_SQL = `
  WITH installment_rows AS (
    SELECT
      i.id,
      i.uuid AS installment_uuid,
      i.installment_number,
      i.description,
      i.due_date,
      i.amount_due,
      i.amount_paid,
      i.late_fee,

      GREATEST(
        i.amount_due + i.late_fee - i.amount_paid,
        0
      ) AS remaining,

      i.status,

      cp.id AS customer_plan_id,

      c.id AS customer_id,
      c.uuid AS customer_uuid,
      l.name AS customer_name,
      l.phone AS customer_phone,

      b.id AS booking_id,
      b.uuid AS booking_uuid,
      b.booking_number,

      pr.id AS project_id,
      pr.name AS project_name,

      p.id AS plot_id,
      p.plot_number AS plot_number

    FROM installments i

    INNER JOIN customer_plans cp
      ON cp.id = i.customer_plan_id

    INNER JOIN bookings b
      ON b.id = cp.booking_id
      AND b.status NOT IN ('cancelled', 'refunded')

    INNER JOIN customers c
      ON c.id = cp.customer_id

    INNER JOIN leads l
      ON l.id = c.lead_id
      AND l.deleted_at IS NULL

    INNER JOIN projects pr
      ON pr.id = b.project_id
      AND pr.deleted_at IS NULL

    INNER JOIN plots p
      ON p.id = b.plot_id
      AND p.deleted_at IS NULL
  )
`;

function buildFilters({ search, status }) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search.trim()}%`);
    const index = params.length;

    conditions.push(`
      (
        customer_name ILIKE $${index}
        OR customer_phone ILIKE $${index}
        OR project_name ILIKE $${index}
        OR plot_number ILIKE $${index}
        OR booking_number ILIKE $${index}
        OR installment_number::text ILIKE $${index}
      )
    `);
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

async function getInstallments({
  page = 1,
  limit = 10,
  search = "",
  status = null,
  sortBy = "due_date",
  sortOrder = "asc",
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const offset = (safePage - 1) * safeLimit;

  const sortColumn = SORT_COLUMNS[sortBy] || SORT_COLUMNS.due_date;

  const direction = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";

  const { where, params } = buildFilters({ search, status });

  const countQuery = `
    ${INSTALLMENT_ROWS_SQL}
    SELECT COUNT(*)::int AS total
    FROM installment_rows
    ${where}
  `;

  const rowsQuery = `
  ${INSTALLMENT_ROWS_SQL}
  SELECT
    id,
    installment_uuid,
    installment_number,
    description,
    TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
    amount_due,
    amount_paid,
    late_fee,
    remaining,
    status,
    customer_plan_id,
    customer_id,
    customer_uuid,
    customer_name,
    customer_phone,
    booking_id,
    booking_uuid,
    booking_number,
    project_id,
    project_name,
    plot_id,
    plot_number
  FROM installment_rows
  ${where}
  ORDER BY ${sortColumn} ${direction} NULLS LAST, id DESC
  LIMIT $${params.length + 1}
  OFFSET $${params.length + 2}
`;

  const statsQuery = `
    ${INSTALLMENT_ROWS_SQL}
    SELECT
      COUNT(*)::int AS total_installments,

      COALESCE(
        SUM(amount_paid), 0
      ) AS paid_amount,

      COALESCE(
        SUM(remaining), 0
      ) AS outstanding_amount,

      COUNT(*) FILTER (
        WHERE status = 'overdue'
      )::int AS overdue_count,

      COUNT(*) FILTER (
        WHERE status IN ('pending', 'partially_paid', 'overdue')
          AND due_date BETWEEN CURRENT_DATE
          AND CURRENT_DATE + 7
          AND remaining > 0
      )::int AS upcoming_count

    FROM installment_rows
    ${where}
  `;

  const [countResult, rowsResult, statsResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(rowsQuery, [...params, safeLimit, offset]),
    pool.query(statsQuery, params),
  ]);

  const total = countResult.rows[0].total;

  return {
    installments: rowsResult.rows,
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

module.exports = { getInstallments };
