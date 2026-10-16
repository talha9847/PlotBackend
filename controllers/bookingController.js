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

async function confirmBooking(req, res) {
  try {
    const { bookingUuid } = req.params;
    const userId = req.user?.id;

    const {
      down_payment,
      installment_count,
      frequency = "monthly",
      start_date,
      status = "active",
      notes = null,
    } = req.body;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!bookingUuid || !uuidRegex.test(bookingUuid)) {
      return res.status(400).json({
        success: false,
        message: "A valid booking UUID is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    if (
      down_payment === undefined ||
      down_payment === null ||
      down_payment === "" ||
      !Number.isFinite(Number(down_payment)) ||
      Number(down_payment) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Down payment must be a valid non-negative number",
      });
    }

    if (
      installment_count === undefined ||
      installment_count === null ||
      installment_count === "" ||
      !Number.isInteger(Number(installment_count)) ||
      Number(installment_count) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Installment count must be a positive integer",
      });
    }

    const allowedFrequencies = [
      "weekly",
      "monthly",
      "quarterly",
      "half_yearly",
      "yearly",
      "milestone",
      "custom",
    ];

    if (!allowedFrequencies.includes(frequency)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment frequency",
      });
    }

    const validDate =
      typeof start_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(start_date) &&
      !Number.isNaN(Date.parse(`${start_date}T00:00:00Z`)) &&
      new Date(`${start_date}T00:00:00Z`).toISOString().startsWith(start_date);

    if (!validDate) {
      return res.status(400).json({
        success: false,
        message: "A valid start date in YYYY-MM-DD format is required",
      });
    }

    const allowedStatuses = ["active", "completed", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment plan status",
      });
    }

    if (notes !== null && (typeof notes !== "string" || notes.length > 5000)) {
      return res.status(400).json({
        success: false,
        message: "Notes must be a string of at most 5000 characters",
      });
    }

    const result = await bookingService.confirmBooking(
      bookingUuid,
      {
        down_payment: Number(down_payment),
        installment_count: Number(installment_count),
        frequency,
        start_date,
        status,
        notes: notes?.trim() || null,
      },
      userId,
    );

    return res.status(200).json({
      success: true,
      message: "Booking confirmed successfully",
      data: result,
    });
  } catch (talha) {
    console.error("Confirm booking error:", talha);

    if (talha.message === "Booking not found") {
      return res.status(404).json({
        success: false,
        message: talha.message,
      });
    }

    if (
      talha.message === "Booking already has a customer" ||
      talha.message === "Cannot confirm a cancelled or refunded booking"
    ) {
      return res.status(409).json({
        success: false,
        message: talha.message,
      });
    }

    if (talha.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "A customer plan already exists for this booking",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to confirm booking",
    });
  }
}

module.exports = {
  createBooking,
  getBookings,
  confirmBooking,
};
