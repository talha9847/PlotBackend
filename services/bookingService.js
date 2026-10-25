"use strict";

const { pool, query } = require("../config/db");
const {
  getNextDueDate,
  generatePaymentNumber,
  applyRefund,
} = require("./paymentService");
const {
  resolveAccount,
  findIdempotentResource,
  recordIdempotencyKey,
  isIdempotencyViolation,
} = require("./financeService");
const { splitInstallmentAmounts } = require("./installmentAmounts");

// These frequencies have a deterministic interval and can be expanded into a
// complete schedule at confirmation time.
const SCHEDULABLE_FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
];

// Milestone and custom plans need an explicit date for every installment.
// The confirmation API does not accept per-installment dates yet, so accepting
// these values would silently produce a schedule with repeated due dates.
const EXPLICIT_DATE_FREQUENCIES = ["milestone", "custom"];

const createServiceError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

function generateBookingNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = require("crypto").randomBytes(4).toString("hex").toUpperCase();

  return `BK-${date}-${suffix}`;
}

async function createBooking(data, createdBy = null, idempotencyKey = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingUuid = await findIdempotentResource(
      client,
      idempotencyKey,
      "booking.create",
    );

    if (existingUuid) {
      await client.query("ROLLBACK");

      const existingResult = await pool.query(
        "SELECT * FROM bookings WHERE uuid = $1 LIMIT 1",
        [existingUuid],
      );

      if (existingResult.rowCount > 0) {
        return {
          ...existingResult.rows[0],
          token_payment: null,
          idempotent_replay: true,
        };
      }
    }

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
      payment_method = "cash",
      account_id,
      payment_date,
      reference_number,
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

    let tokenPayment = null;

    if (Number(booking_amount) > 0) {
      const account = await resolveAccount(client, {
        paymentMethod: payment_method,
        accountId: account_id,
      });

      const receiptDate = String(
        payment_date || booking_date || new Date().toISOString().slice(0, 10),
      ).slice(0, 10);
      const paymentNumber = await generatePaymentNumber(
        client,
        Number(receiptDate.slice(0, 4)),
      );

      const tokenResult = await client.query(
        `INSERT INTO payments (
           payment_number,
           booking_id,
           customer_id,
           installment_id,
           account_id,
           payment_method,
           amount,
           payment_date,
           transaction_reference,
           received_by,
           status,
           payment_purpose,
           notes
         )
         VALUES (
           $1, $2, NULL, NULL, $3, $4, $5,
           $6::date::timestamptz, $7, $8, 'completed', 'booking_token', $9
         )
         RETURNING *`,
        [
          paymentNumber,
          bookingResult.rows[0].id,
          account.id,
          payment_method,
          booking_amount,
          receiptDate,
          reference_number?.trim() || null,
          createdBy || null,
          notes?.trim() || null,
        ],
      );

      tokenPayment = tokenResult.rows[0];
    }

    await recordIdempotencyKey(
      client,
      idempotencyKey,
      "booking.create",
      bookingResult.rows[0].uuid,
    );

    await client.query("COMMIT");

    return {
      ...bookingResult.rows[0],
      plot: plotUpdate.rows[0],
      token_payment: tokenPayment,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Booking rollback failed:", rollbackError);
    }

    if (isIdempotencyViolation(error) && idempotencyKey) {
      const existingResult = await pool.query(
        `SELECT b.*
         FROM idempotency_keys k
         INNER JOIN bookings b ON b.uuid = k.resource_uuid
         WHERE k.key = $1
           AND k.scope = 'booking.create'
         LIMIT 1`,
        [idempotencyKey],
      );

      if (existingResult.rowCount > 0) {
        return {
          ...existingResult.rows[0],
          token_payment: null,
          idempotent_replay: true,
        };
      }
    }

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
      payment_method = "cash",
      account_id,
      payment_date,
      reference_number,
    } = data;

    const bookingResult = await client.query(
      `
        SELECT id, lead_id, customer_id, status, total_amount, booking_amount
        FROM bookings
        WHERE uuid = $1
        FOR UPDATE
      `,
      [bookingUuid],
    );

    if (bookingResult.rowCount === 0) {
      throw createServiceError("Booking not found", 404);
    }

    const booking = bookingResult.rows[0];

    if (booking.status === "cancelled" || booking.status === "refunded") {
      throw createServiceError(
        "Cannot confirm a cancelled or refunded booking",
        409,
      );
    }

    if (booking.status !== "pending") {
      throw createServiceError("Only pending bookings can be confirmed", 409);
    }

    if (booking.customer_id) {
      throw createServiceError("Booking already has a customer", 409);
    }
    const totalAmount = Number(booking.total_amount);
    const bookingAmount = Number(booking.booking_amount);
    const downPayment = Number(down_payment);
    const installmentCount = Number(installment_count);

    if (!SCHEDULABLE_FREQUENCIES.includes(frequency)) {
      if (EXPLICIT_DATE_FREQUENCIES.includes(frequency)) {
        throw createServiceError(
          "Milestone and custom payment plans require an explicit due date for every installment and are not supported by this endpoint yet.",
          400,
        );
      }

      throw createServiceError("Invalid payment frequency", 400);
    }

    if (
      !Number.isFinite(totalAmount) ||
      !Number.isFinite(bookingAmount) ||
      !Number.isFinite(downPayment) ||
      downPayment < 0 ||
      !Number.isInteger(installmentCount) ||
      installmentCount <= 0
    ) {
      throw createServiceError("Invalid payment plan details", 400);
    }

    const remainingPayment = Number(
      (totalAmount - bookingAmount - downPayment).toFixed(2),
    );

    if (remainingPayment < 0) {
      throw createServiceError(
        "Booking token and down payment cannot exceed the booking total",
        400,
      );
    }

    if (!Number.isSafeInteger(remainingPayment)) {
      throw createServiceError(
        "Remaining balance must be a whole rupee amount. Adjust the down payment.",
        400,
      );
    }

    if (remainingPayment < installmentCount) {
      throw createServiceError(
        "Remaining balance must be at least the number of installments.",
        400,
      );
    }

    let installmentAmounts;

    try {
      installmentAmounts = splitInstallmentAmounts(
        remainingPayment,
        installmentCount,
      );
    } catch (error) {
      throw createServiceError(error.message, 400);
    }

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
          remaining_balance,
          notes,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        remainingPayment,
        notes,
        userId,
      ],
    );

    const customerPlanId = planResult.rows[0].id;

    // Generate the complete installment schedule (1 to installment_count).
    // Amounts stay within one rupee of each other and sum exactly to the plan
    // balance, with the extra rupee distributed across the final rows.
    let previousDueDate = String(start_date).slice(0, 10);
    const createdInstallments = [];

    for (let i = 1; i <= Number(installment_count); i++) {
      let currentDueDate = previousDueDate;

      if (i > 1) {
        currentDueDate = getNextDueDate(previousDueDate, frequency);

        if (!currentDueDate) {
          throw createServiceError(
            `Unable to calculate installment due date for frequency "${frequency}"`,
            400,
          );
        }
      }

      previousDueDate = currentDueDate;

      const currentAmountDue = installmentAmounts[i - 1];

      const instResult = await client.query(
        `
          INSERT INTO installments (
            customer_plan_id,
            installment_number,
            description,
            due_date,
            amount_due,
            amount_paid,
            status
          )
          VALUES ($1, $2, $3, $4, $5, 0, 'pending')
          ON CONFLICT (customer_plan_id, installment_number) DO NOTHING
          RETURNING *
        `,
        [
          customerPlanId,
          i,
          `Installment ${i}`,
          currentDueDate,
          currentAmountDue,
        ],
      );

      if (instResult.rows[0]) {
        createdInstallments.push(instResult.rows[0]);
      }
    }

    // Link any existing booking token payments to the new customer
    await client.query(
      `
        UPDATE payments
        SET customer_id = $1,
            updated_at = NOW()
        WHERE booking_id = $2
          AND customer_id IS NULL
      `,
      [customerId, booking.id],
    );

    let downPaymentReceipt = null;

    if (downPayment > 0) {
      const account = await resolveAccount(client, {
        paymentMethod: payment_method,
        accountId: account_id,
      });

      const receiptDate = String(
        payment_date || new Date().toISOString().slice(0, 10),
      ).slice(0, 10);
      const paymentNumber = await generatePaymentNumber(
        client,
        Number(receiptDate.slice(0, 4)),
      );

      const receiptResult = await client.query(
        `INSERT INTO payments (
           payment_number,
           booking_id,
           customer_id,
           installment_id,
           account_id,
           payment_method,
           amount,
           payment_date,
           transaction_reference,
           received_by,
           status,
           payment_purpose,
           notes
         )
         VALUES (
           $1, $2, $3, NULL, $4, $5, $6,
           $7::date::timestamptz, $8, $9, 'completed', 'down_payment', $10
         )
         RETURNING *`,
        [
          paymentNumber,
          booking.id,
          customerId,
          account.id,
          payment_method,
          down_payment,
          receiptDate,
          reference_number?.trim() || null,
          userId || null,
          notes?.trim() || null,
        ],
      );

      downPaymentReceipt = receiptResult.rows[0];
    }

    await client.query("COMMIT");

    return {
      customer_id: customerId,
      booking_id: bookingUuid,
      plan: planResult.rows[0],
      installments: createdInstallments,
      down_payment_receipt: downPaymentReceipt,
    };
  } catch (talha_9106704675) {
    await client.query("ROLLBACK");
    throw talha_9106704675;
  } finally {
    client.release();
  }
}

async function cancelBooking(bookingUuid, data = {}, userId = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      `SELECT
         b.*,
         p.uuid AS plot_uuid,
         p.plot_number,
         p.status AS plot_status
       FROM bookings b
       INNER JOIN plots p ON p.id = b.plot_id
       WHERE b.uuid = $1
       FOR UPDATE OF b, p`,
      [bookingUuid],
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      throw createServiceError("Booking not found", 404);
    }

    if (booking.status !== "pending") {
      throw createServiceError(
        `Only pending bookings can be cancelled. This booking is "${booking.status}".`,
        409,
      );
    }

    const cancellationReason =
      String(data.reason || "").trim() || "Booking cancelled";

    if (cancellationReason.length > 5000) {
      throw createServiceError(
        "Cancellation reason cannot exceed 5000 characters.",
        400,
      );
    }

    let refund = null;

    if (data.refund_token === true) {
      const tokenResult = await client.query(
        `SELECT *
         FROM payments
         WHERE booking_id = $1
           AND payment_purpose = 'booking_token'
         ORDER BY id
         LIMIT 1
         FOR UPDATE`,
        [booking.id],
      );

      const tokenPayment = tokenResult.rows[0];

      if (tokenPayment) {
        const refundedResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS refunded
           FROM payment_reversals
           WHERE original_payment_id = $1
             AND status IN ('pending', 'completed')`,
          [tokenPayment.id],
        );

        const refundable = Number(
          (
            Number(tokenPayment.amount) -
            Number(refundedResult.rows[0].refunded ?? 0)
          ).toFixed(2),
        );

        if (refundable > 0) {
          const refundResult = await applyRefund(
            client,
            tokenPayment,
            {
              amount: refundable,
              reason: cancellationReason,
              payment_method:
                data.refund_method || tokenPayment.payment_method,
              account_id: data.refund_account_id ?? tokenPayment.account_id,
              refund_date: data.refund_date,
              reference_number: data.reference_number,
            },
            userId,
          );

          refund = refundResult.refund;
        }
      }
    }

    const updatedResult = await client.query(
      `UPDATE bookings
       SET status = 'cancelled',
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [cancellationReason, booking.id],
    );

    // Releasing the plot is safe because the booking is being cancelled in the
    // same transaction and the plot row is locked.
    const plotResult = await client.query(
      `UPDATE plots
       SET status = 'available',
           updated_at = NOW()
       WHERE id = $1
         AND status = 'booked'
         AND deleted_at IS NULL
       RETURNING id, uuid, plot_number, status`,
      [booking.plot_id],
    );

    await client.query("COMMIT");

    return {
      booking: updatedResult.rows[0],
      plot: plotResult.rows[0] || null,
      refund,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Cancel booking rollback failed:", rollbackError);
    }

    throw error;
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
  cancelBooking,
};
