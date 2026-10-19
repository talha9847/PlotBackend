const { query } = require("../config/db");

const SORT_COLUMNS = {
  date: "p.payment_date",
  amount: "p.amount",
  customer: "l.name",
  number: "p.payment_number",
  status: "p.status",
};

function buildTransactionFilters(filters = {}) {
  const conditions = [];
  const values = [];

  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const {
    search,
    customer_id,
    project_id,
    plot_id,
    account_id,
    payment_method,
    status,
    start_date,
    end_date,
    min_amount,
    max_amount,
  } = filters;


  if (search?.trim()) {
    const param = add(`%${search.trim()}%`);

    conditions.push(`(
      p.payment_number ILIKE ${param}
      OR b.booking_number ILIKE ${param}
      OR l.name ILIKE ${param}
      OR l.phone ILIKE ${param}
      OR pr.name ILIKE ${param}
      OR pl.plot_number ILIKE ${param}
      OR a.account_name ILIKE ${param}
      OR p.payment_method ILIKE ${param}
      OR p.status ILIKE ${param}
      OR p.notes ILIKE ${param}
    )`);
  }

  if (customer_id) {
    conditions.push(
      `COALESCE(p.customer_id, b.customer_id) = ${add(customer_id)}`,
    );
  }

  if (project_id) {
    conditions.push(`b.project_id = ${add(project_id)}`);
  }

  if (plot_id) {
    conditions.push(`b.plot_id = ${add(plot_id)}`);
  }

  if (account_id) {
    conditions.push(`p.account_id = ${add(account_id)}`);
  }

  if (payment_method) {
    conditions.push(`p.payment_method = ${add(payment_method)}`);
  }

  if (status) {
    conditions.push(`p.status = ${add(status)}`);
  }

  if (start_date) {
    conditions.push(`p.payment_date >= ${add(start_date)}::date`);
  }

  if (end_date) {
    conditions.push(
      `p.payment_date < (${add(end_date)}::date + INTERVAL '1 day')`,
    );
  }

  if (min_amount !== undefined && min_amount !== "") {
    conditions.push(`p.amount >= ${add(min_amount)}`);
  }

  if (max_amount !== undefined && max_amount !== "") {
    conditions.push(`p.amount <= ${add(max_amount)}`);
  }
  return {
    where: conditions.length > 0 ? conditions.join(" AND ") : "TRUE",
    values,
    add,
  };
}

const FROM_SQL = `
  FROM payments p
  LEFT JOIN bookings b
    ON b.id = p.booking_id
  LEFT JOIN customers c
    ON c.id = COALESCE(p.customer_id, b.customer_id)
  LEFT JOIN leads l
    ON l.id = c.lead_id
    AND l.deleted_at IS NULL
  LEFT JOIN projects pr
    ON pr.id = b.project_id
    AND pr.deleted_at IS NULL
  LEFT JOIN plots pl
    ON pl.id = b.plot_id
    AND pl.deleted_at IS NULL
  LEFT JOIN accounts a
    ON a.id = p.account_id
  LEFT JOIN users u
    ON u.id = p.received_by
    AND u.deleted_at IS NULL
`;

const SELECT_SQL = `
  SELECT
    p.id,
    p.uuid,
    p.payment_number AS "paymentNumber",
    p.payment_date AS "paymentDate",
    COALESCE(p.customer_id, b.customer_id) AS "customerId",
    l.name AS "customerName",
    l.phone AS "customerPhone",
    c.uuid,
    b.project_id AS "projectId",
    pr.name AS "projectName",
    b.plot_id AS "plotId",
    pl.plot_number AS "plotNumber",
    p.account_id AS "accountId",
    a.account_name AS "accountName",
    a.bank_name AS "bankName",
    p.payment_method AS "paymentMethod",
    p.status,
    p.amount,
    p.booking_id AS "bookingId",
    b.booking_number AS "bookingNumber",
    u.full_name AS "receivedBy",
    p.notes
  ${FROM_SQL}
`;

async function getTransactions({
  page = 1,
  limit = 10,
  sort_by = "date",
  sort_order = "desc",
  ...filters
} = {}) {
  page = Math.max(1, Number.parseInt(page, 10) || 1);
  limit = Math.max(1, Number.parseInt(limit, 10) || 10);

  const { where, values, add } = buildTransactionFilters(filters);

  const sortColumn = SORT_COLUMNS[sort_by] || SORT_COLUMNS.date;
  const sortDirection =
    String(sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";

  const offset = (page - 1) * limit;
  const limitParam = add(limit);
  const offsetParam = add(offset);

  const [transactionResult, countResult, summaryResult] = await Promise.all([
    query(
      `${SELECT_SQL}
         WHERE ${where}
         ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, p.id DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    ),

    query(
      `SELECT COUNT(*)::int AS total
         ${FROM_SQL}
         WHERE ${where}`,
      values.slice(0, values.length - 2),
    ),

    query(
      `SELECT
           COUNT(*)::int AS "totalTransactions",
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.status = 'completed'
           ), 0) AS "completedTotal",
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.status = 'pending'
           ), 0) AS "pendingTotal",
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.status IN ('refunded', 'partially_refunded')
           ), 0) AS "refundedTotal"
         ${FROM_SQL}
         WHERE ${where}`,
      values.slice(0, values.length - 2),
    ),
  ]);

  const total = countResult.rows[0].total;

  return {
    transactions: transactionResult.rows,
    summary: summaryResult.rows[0],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function getTransactionsForExport(filters = {}) {
  const { where, values } = buildTransactionFilters(filters);

  const result = await query(
    `${SELECT_SQL}
     WHERE ${where}
     ORDER BY p.payment_date DESC NULLS LAST, p.id DESC`,
    values,
  );

  return result.rows;
}

module.exports = {
  getTransactions,
  getTransactionsForExport,
};
