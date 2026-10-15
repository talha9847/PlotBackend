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

module.exports = {
  createBooking,
};
