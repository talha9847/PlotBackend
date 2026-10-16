"use strict";

const bookingService = require("../services/bookingService");

const isPositiveId = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  /^\d+$/.test(String(value)) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;

const isValidAmount = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  /^\d+(\.\d{1,2})?$/.test(String(value)) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= 999999999999.99;

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

async function createBooking(req, res, next) {
  try {
    const body = req.body || {};

    const {
      project_id,
      plot_id,
      lead_id,
      booking_date,
      agreed_price,
      discount_amount = 0,
      tax_amount = 0,
      booking_amount = 0,
      notes = null,
    } = body;

    const errors = {};

    if (!isPositiveId(project_id)) {
      errors.project_id = "A valid project ID is required";
    }

    if (!isPositiveId(plot_id)) {
      errors.plot_id = "A valid plot ID is required";
    }

    if (!isPositiveId(lead_id)) {
      errors.lead_id = "A valid lead ID is required";
    }

    if (
      booking_date !== undefined &&
      booking_date !== null &&
      booking_date !== "" &&
      !isValidDate(booking_date)
    ) {
      errors.booking_date = "Enter a valid date in YYYY-MM-DD format";
    }

    if (!isValidAmount(agreed_price)) {
      errors.agreed_price = "Enter a valid non-negative agreed price";
    }

    if (!isValidAmount(discount_amount)) {
      errors.discount_amount = "Enter a valid non-negative discount amount";
    }

    if (!isValidAmount(tax_amount)) {
      errors.tax_amount = "Enter a valid non-negative tax amount";
    }

    if (!isValidAmount(booking_amount)) {
      errors.booking_amount = "Enter a valid non-negative booking amount";
    }

    if (notes !== null && typeof notes !== "string") {
      errors.notes = "Notes must be a string";
    } else if (typeof notes === "string" && notes.length > 10000) {
      errors.notes = "Notes cannot exceed 10000 characters";
    }

    if (
      isValidAmount(agreed_price) &&
      isValidAmount(discount_amount) &&
      Number(discount_amount) > Number(agreed_price)
    ) {
      errors.discount_amount = "Discount cannot exceed agreed price";
    }

    if (
      isValidAmount(agreed_price) &&
      isValidAmount(discount_amount) &&
      isValidAmount(tax_amount) &&
      isValidAmount(booking_amount) &&
      Number(discount_amount) <= Number(agreed_price)
    ) {
      const total =
        Number(agreed_price) - Number(discount_amount) + Number(tax_amount);

      if (Number(booking_amount) > total) {
        errors.booking_amount = "Booking amount cannot exceed total amount";
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    const booking = await bookingService.createBooking(
      {
        project_id,
        plot_id,
        lead_id,
        booking_date: booking_date || null,
        agreed_price,
        discount_amount,
        tax_amount,
        booking_amount,
        notes: notes?.trim() || null,
      },
      req.user?.id ?? null,
    );

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: { booking },
    });
  } catch (error) {
    next(error);
  }
}

async function getBookings(req, res, next) {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "created_at",
      sortOrder = "desc",
      status = "",
    } = req.query;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (
      !Number.isSafeInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isSafeInteger(parsedLimit) ||
      parsedLimit < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be positive integers",
      });
    }

    if (parsedLimit > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit cannot exceed 100",
      });
    }

    if (
      typeof search !== "string" ||
      search.length > 200 ||
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      typeof status !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking query parameters",
      });
    }

    if (status && !bookingService.BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking status filter",
      });
    }

    const allowedSortColumns = Object.keys(bookingService.SORT_COLUMNS);
    if (!allowedSortColumns.includes(sortBy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort field",
      });
    }

    if (!["asc", "desc"].includes(sortOrder.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Sort order must be asc or desc",
      });
    }

    const result = await bookingService.getBookings({
      page: parsedPage,
      limit: parsedLimit,
      search: search.trim(),
      sortBy,
      sortOrder: sortOrder.toLowerCase(),
      status,
    });

    return res.status(200).json({
      success: true,
      message: "Bookings fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}



module.exports = {
  createBooking,
  getBookings,
};
