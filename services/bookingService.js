"use strict";

const { pool, query } = require("../config/db");

function generateBookingNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = require("crypto").randomBytes(4).toString("hex").toUpperCase();

  return `BK-${date}-${suffix}`;
}

async function createBooking(data, createdBy = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      project_id,
      plot_id,
      lead_id,
      booking_date,
      agreed_price,
      discount_amount = 0,
      tax_amount = 0,
      booking_amount = 0,
      notes,
    } = data;

    // Lock the plot to prevent simultaneous bookings.
    const plotResult = await client.query(
      `SELECT
         p.id,
         p.project_id,
         p.status,
         p.deleted_at,
         pr.deleted_at AS project_deleted_at
       FROM plots p
       JOIN projects pr ON pr.id = p.project_id
       WHERE p.id = $1
       FOR UPDATE OF p`,
      [plot_id],
    );

    const plot = plotResult.rows[0];

    if (!plot || plot.deleted_at || plot.project_deleted_at) {
      const error = new Error("Plot or project not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(plot.project_id) !== String(project_id)) {
      const error = new Error("Plot does not belong to the selected project");
      error.statusCode = 400;
      throw error;
    }

    if (plot.status !== "available") {
      const error = new Error("Plot is no longer available for booking");
      error.statusCode = 409;
      throw error;
    }

    // Verify that the lead exists and is active.
    const leadResult = await client.query(
      `SELECT id
       FROM leads
       WHERE id = $1
         AND deleted_at IS NULL
       FOR SHARE`,
      [lead_id],
    );

    if (leadResult.rowCount === 0) {
      const error = new Error("Lead not found");
      error.statusCode = 404;
      throw error;
    }

    // Calculate total using PostgreSQL numeric arithmetic.
    const totalResult = await client.query(
      `SELECT (
         $1::numeric - $2::numeric + $3::numeric
       )::numeric(14, 2) AS total_amount`,
      [agreed_price, discount_amount, tax_amount],
    );

    const totalAmount = totalResult.rows[0].total_amount;

    const bookingResult = await client.query(
      `INSERT INTO bookings (
         booking_number,
         project_id,
         plot_id,
         lead_id,
         booking_date,
         agreed_price,
         discount_amount,
         tax_amount,
         total_amount,
         booking_amount,
         status,
         notes,
         created_by
       )
       VALUES (
         $1, $2, $3, $4,
         COALESCE($5::date, CURRENT_DATE),
         $6, $7, $8, $9, $10,
         'pending', $11, $12
       )
       RETURNING *`,
      [
        generateBookingNumber(),
        project_id,
        plot_id,
        lead_id,
        booking_date || null,
        agreed_price,
        discount_amount,
        tax_amount,
        totalAmount,
        booking_amount,
        notes || null,
        createdBy,
      ],
    );

    // Update the plot in the same transaction.
    const plotUpdate = await client.query(
      `UPDATE plots
       SET status = 'booked',
           updated_at = NOW()
       WHERE id = $1
         AND status = 'available'
         AND deleted_at IS NULL
       RETURNING id, uuid, plot_number, status`,
      [plot_id],
    );

    if (plotUpdate.rowCount !== 1) {
      const error = new Error("Plot availability changed. Please try again");
      error.statusCode = 409;
      throw error;
    }

    await client.query("COMMIT");

    return {
      ...bookingResult.rows[0],
      plot: plotUpdate.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Only allow known SQL columns for sorting. Never interpolate user input directly.
const SORT_COLUMNS = {
  booking_number: "b.booking_number",
  booking_date: "b.booking_date",
  status: "b.status",
  agreed_price: "b.agreed_price",
  total_amount: "b.total_amount",
  booking_amount: "b.booking_amount",
  created_at: "b.created_at",
  updated_at: "b.updated_at",
  customer_name: "l.name",
  customer_phone: "l.phone",
  project_name: "pr.name",
  plot_number: "p.plot_number",
};

const BOOKING_STATUSES = [
  "pending",
  "reserved",
  "confirmed",
  "cancelled",
  "completed",
  "refunded",
];

async function getBookings({
  page = 1,
  limit = 10,
  search = "",
  sortBy = "created_at",
  sortOrder = "desc",
  status = "",
}) {
  const offset = (page - 1) * limit;

  const sortColumn = SORT_COLUMNS[sortBy] || SORT_COLUMNS.created_at;

  const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  // Build search and status conditions.
  const conditions = ["1 = 1"];
  const values = [];

  if (search.trim()) {
    values.push(`%${search.trim()}%`);
    const index = values.length;

    conditions.push(`(
      b.booking_number ILIKE $${index}
      OR l.name ILIKE $${index}
      OR l.phone ILIKE $${index}
      OR COALESCE(l.alternate_phone, '') ILIKE $${index}
      OR COALESCE(l.email, '') ILIKE $${index}
      OR pr.name ILIKE $${index}
      OR p.plot_number ILIKE $${index}
      OR b.status ILIKE $${index}
      OR COALESCE(b.notes, '') ILIKE $${index}
    )`);
  }

  if (status) {
    values.push(status);
    conditions.push(`b.status = $${values.length}`);
  }

  const whereClause = conditions.join(" AND ");

  // 1. Get overall booking statistics.
  // These counts do not change with search, status tabs, or pagination.
  const statsResult = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE status = 'pending'
      )::int AS pending,
      COUNT(*) FILTER (
        WHERE status = 'reserved'
      )::int AS reserved,
      COUNT(*) FILTER (
        WHERE status = 'confirmed'
      )::int AS confirmed,
      COUNT(*) FILTER (
        WHERE status = 'cancelled'
      )::int AS cancelled,
      COUNT(*) FILTER (
        WHERE status = 'completed'
      )::int AS completed,
      COUNT(*) FILTER (
        WHERE status = 'refunded'
      )::int AS refunded
    FROM bookings
  `);

  const stats = statsResult.rows[0] || {
    total: 0,
    pending: 0,
    reserved: 0,
    confirmed: 0,
    cancelled: 0,
    completed: 0,
    refunded: 0,
  };

  // 2. Common joins for the booking list and filtered count.
  const joins = `
    FROM bookings b
    INNER JOIN projects pr
      ON pr.id = b.project_id
    INNER JOIN plots p
      ON p.id = b.plot_id
    INNER JOIN leads l
      ON l.id = b.lead_id
    LEFT JOIN users creator
      ON creator.id = b.created_by
      AND creator.deleted_at IS NULL
  `;

  // 3. Count records matching the current search and status filter.
  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      ${joins}
      WHERE ${whereClause}
    `,
    values,
  );

  const total = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // 4. Fetch the current page.
  const dataValues = [...values, limit, offset];

  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;

  const result = await query(
    `
      SELECT
        b.id,
        b.uuid,
        b.booking_number,

        b.project_id,
        pr.uuid AS project_uuid,
        pr.name AS project_name,

        b.plot_id,
        p.uuid AS plot_uuid,
        p.plot_number,
        p.plot_type,
        p.status AS plot_status,

        b.lead_id,
        l.uuid AS lead_uuid,
        l.name AS customer_name,
        l.phone AS customer_phone,
        l.alternate_phone AS customer_alternate_phone,
        l.email AS customer_email,

        b.booking_date,
        b.agreed_price,
        b.discount_amount,
        b.tax_amount,
        b.total_amount,
        b.booking_amount,

        b.status,
        b.cancellation_reason,
        b.notes,

        b.created_by,
        creator.full_name AS created_by_name,

        b.created_at,
        b.updated_at

      ${joins}

      WHERE ${whereClause}

      ORDER BY ${sortColumn} ${direction}, b.id DESC

      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    dataValues,
  );

  return {
    bookings: result.rows,

    stats,

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

async function confirmBooking(bookingUuid, data, userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      down_payment,
      installment_count,
      frequency = "monthly",
      start_date,
      status = "active",
      notes = null,
    } = data;

    // 1. Get the existing booking and lock it.
    const bookingResult = await client.query(
      `
        SELECT id, lead_id, customer_id, status
        FROM bookings
        WHERE uuid = $1
        FOR UPDATE
      `,
      [bookingUuid],
    );

    if (bookingResult.rowCount === 0) {
      throw new Error("Booking not found");
    }

    const booking = bookingResult.rows[0];

    if (booking.status === "cancelled" || booking.status === "refunded") {
      throw new Error("Cannot confirm a cancelled or refunded booking");
    }

    if (booking.customer_id) {
      throw new Error("Booking already has a customer");
    }

    // 2. Create customer or reuse the existing customer for this lead.
    const customerResult = await client.query(
      `
        INSERT INTO customers (lead_id)
        VALUES ($1)
        ON CONFLICT (lead_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `,
      [booking.lead_id],
    );

    const customerId = customerResult.rows[0].id;

    // 3. Update the existing booking with customer_id.
    await client.query(
      `
        UPDATE bookings
        SET customer_id = $1,
            status = 'confirmed',
            updated_at = NOW()
        WHERE uuid = $2
      `,
      [customerId, bookingUuid],
    );

    // 4. Create the installment plan.
    const planResult = await client.query(
      `
        INSERT INTO customer_plans (
          customer_id,
          booking_id,
          down_payment,
          installment_count,
          frequency,
          start_date,
          status,
          notes,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        customerId,
        booking.id,
        down_payment,
        installment_count,
        frequency,
        start_date,
        status,
        notes,
        userId,
      ],
    );

    await client.query("COMMIT");

    return {
      customer_id: customerId,
      booking_id: bookingUuid,
      plan: planResult.rows[0],
    };
  } catch (talha_9106704675) {
    await client.query("ROLLBACK");
    throw talha_9106704675;
  } finally {
    client.release();
  }
}

module.exports = {
  createBooking,
  getBookings,
  BOOKING_STATUSES,
  SORT_COLUMNS,
  confirmBooking,
};
