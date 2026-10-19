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

const getCustomerProfile = async (uuid) => {
  // 1. Fetch customer details
  const customerResult = await query(
    `
      SELECT
        c.id,
        c.uuid,
        c.created_at AS customer_since,
        l.id AS lead_id,
        l.uuid AS lead_uuid,
        l.name,
        l.phone,
        l.alternate_phone,
        l.email,
        l.broker_id,
        u.full_name AS broker_name
      FROM customers c
      INNER JOIN leads l
        ON l.id = c.lead_id
      LEFT JOIN users u
        ON u.id = l.broker_id
        AND u.deleted_at IS NULL
      WHERE c.uuid = $1
        AND l.deleted_at IS NULL
      LIMIT 1
    `,
    [uuid],
  );

  if (!customerResult.rows.length) {
    return null;
  }

  const customer = customerResult.rows[0];

  // 2. Fetch bookings, plots, projects, and payment plans
  const bookingsResult = await query(
    `
      SELECT
        b.id AS booking_id,
        b.uuid AS booking_uuid,
        b.booking_number,
        b.booking_date,
        b.status AS booking_status,
        b.project_id,
        pr.name AS project_name,
        b.plot_id,
        p.uuid AS plot_uuid,
        p.plot_number,
        p.plot_type,
        p.base_price,
        p.status AS plot_status,
        b.agreed_price,
        b.discount_amount,
        b.tax_amount,
        b.total_amount,
        b.booking_amount,
        cp.id AS customer_plan_id,
        cp.uuid AS customer_plan_uuid,
        cp.down_payment,
        cp.installment_count,
        cp.frequency,
        cp.start_date,
        cp.status AS plan_status,
        cp.remaining_balance
      FROM bookings b
      INNER JOIN plots p
        ON p.id = b.plot_id
      INNER JOIN projects pr
        ON pr.id = b.project_id
      LEFT JOIN customer_plans cp
        ON cp.booking_id = b.id
        AND cp.customer_id = b.customer_id
      WHERE b.customer_id = $1
        AND b.status NOT IN ('cancelled', 'refunded')
        AND p.deleted_at IS NULL
        AND pr.deleted_at IS NULL
      ORDER BY b.booking_date DESC, b.id DESC
    `,
    [customer.id],
  );

  // 3. Fetch installments across all customer plans
  const installmentsResult = await query(
    `
      SELECT
        i.id AS installment_id,
        i.uuid AS installment_uuid,
        i.customer_plan_id,
        cp.booking_id,
        b.booking_number,
        b.customer_id,
        p.plot_number,
        i.installment_number,
        i.description,
        i.due_date,
        i.amount_due,
        i.amount_paid,
        i.late_fee,
        i.status,
        i.paid_at,
        i.notes,
        i.created_at,
        i.updated_at
      FROM installments i
      INNER JOIN customer_plans cp
        ON cp.id = i.customer_plan_id
      INNER JOIN bookings b
        ON b.id = cp.booking_id
      INNER JOIN plots p
        ON p.id = b.plot_id
      WHERE cp.customer_id = $1
        AND b.status NOT IN ('cancelled', 'refunded')
      ORDER BY i.due_date ASC, i.installment_number ASC
    `,
    [customer.id],
  );

  // 4. Fetch individual payment transactions
  const paymentsResult = await query(
    `
      SELECT
        pay.id AS payment_id,
        pay.uuid AS payment_uuid,
        pay.payment_number,
        pay.booking_id,
        pay.customer_id,
        pay.installment_id,
        pay.payment_method,
        pay.amount,
        pay.payment_date,
        pay.received_by,
        receiver.full_name AS received_by_name,
        pay.status AS payment_status,
        pay.notes,
        pay.created_at,
        pay.updated_at,
        b.booking_number,
        i.installment_number,
        p.plot_number
      FROM payments pay
      INNER JOIN bookings b
        ON b.id = pay.booking_id
      LEFT JOIN installments i
        ON i.id = pay.installment_id
      LEFT JOIN users receiver
        ON receiver.id = pay.received_by
        AND receiver.deleted_at IS NULL
      LEFT JOIN plots p
        ON p.id = b.plot_id
      WHERE pay.customer_id = $1
        AND b.status NOT IN ('cancelled', 'refunded')
      ORDER BY pay.payment_date DESC, pay.id DESC
    `,
    [customer.id],
  );

  const bookings = bookingsResult.rows;
  const installments = installmentsResult.rows;
  const payments = paymentsResult.rows;

  // 5. Calculate customer statistics
  const totalInvestment = bookings.reduce(
    (sum, booking) => sum + Number(booking.total_amount || 0),
    0,
  );

  // Remaining balance is maintained by the payment service.
  const outstandingBalance = bookings.reduce(
    (sum, booking) =>
      sum +
      Number(
        booking.remaining_balance ??
          Math.max(
            0,
            Number(booking.total_amount || 0) -
              Number(booking.down_payment || booking.booking_amount || 0),
          ),
      ),
    0,
  );

  // Count only completed transactions as collected payments.
  const completedPayments = payments.filter(
    (payment) => payment.payment_status === "completed",
  );

  const totalCollected = completedPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );

  const paidInstallments = installments.filter(
    (item) => item.status === "paid",
  );

  const upcomingInstallments = installments.filter((item) =>
    ["pending", "partially_paid"].includes(item.status),
  );

  const overdueInstallments = installments.filter(
    (item) => item.status === "overdue",
  );

  // 6. Attach installments and payments to each booking
  const bookingDetails = bookings.map((booking) => {
    const bookingInstallments = installments
      .filter((item) => String(item.booking_id) === String(booking.booking_id))
      .map((installment) => ({
        ...installment,
        payments: payments.filter(
          (payment) =>
            String(payment.installment_id) ===
            String(installment.installment_id),
        ),
      }));

    const bookingPayments = payments.filter(
      (payment) => String(payment.booking_id) === String(booking.booking_id),
    );

    return {
      ...booking,
      balance: Number(
        booking.remaining_balance ??
          Math.max(
            0,
            Number(booking.total_amount || 0) -
              Number(booking.down_payment || booking.booking_amount || 0),
          ),
      ),
      installments: bookingInstallments,
      payments: bookingPayments,
    };
  });

  // 7. Return customer profile
  return {
    customer: {
      ...customer,
      status: "Active",
    },

    stats: {
      total_plots: bookingDetails.length,

      total_projects: new Set(
        bookingDetails.map((booking) => String(booking.project_id)),
      ).size,

      total_bookings: bookings.length,

      total_investment: totalInvestment,

      total_collected: totalCollected,

      outstanding_balance: outstandingBalance,

      collection_percentage:
        totalInvestment > 0
          ? Number(((totalCollected / totalInvestment) * 100).toFixed(2))
          : 0,

      total_installments: installments.length,
      paid_installments: paidInstallments.length,
      upcoming_installments: upcomingInstallments.length,
      overdue_installments: overdueInstallments.length,

      total_payments: payments.length,
      completed_payments: completedPayments.length,
      pending_payments: payments.filter(
        (payment) => payment.payment_status === "pending",
      ).length,
    },

    bookings: bookingDetails,

    installments,

    payments,

    upcoming_installments: upcomingInstallments,

    overdue_installments: overdueInstallments,
  };
};

async function getCustomersDropdown({ search }) {
  const queryString = `
    SELECT
      c.id,
      c.uuid,
      c.lead_id AS "leadId",
      l.name AS "name",
      l.phone,
      l.email,
      l.broker_id AS "brokerId",
      b.name AS "brokerName"
    FROM customers c
    INNER JOIN leads l
      ON l.id = c.lead_id
      AND l.deleted_at IS NULL
    LEFT JOIN brokers b
      ON b.id = l.broker_id
    WHERE
      (
        $1::text IS NULL
        OR l.name ILIKE '%' || $1 || '%'
        OR l.phone ILIKE '%' || $1 || '%'
        OR l.email ILIKE '%' || $1 || '%'
        OR b.name ILIKE '%' || $1 || '%'
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

module.exports = { getCustomers, getCustomerProfile, getCustomersDropdown };
