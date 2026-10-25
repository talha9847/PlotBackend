"use strict";

const bookingService = require("../services/bookingService");
const financeService = require("../services/financeService");

const { PAYMENT_METHODS, getIdempotencyKey } = financeService;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      payment_method = "cash",
      account_id,
      payment_date,
      reference_number,
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

    if (!PAYMENT_METHODS.includes(payment_method)) {
      errors.payment_method = "Select a valid payment method";
    }

    if (
      payment_date !== undefined &&
      payment_date !== null &&
      payment_date !== "" &&
      !isValidDate(payment_date)
    ) {
      errors.payment_date = "Enter a valid date in YYYY-MM-DD format";
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      errors.reference_number =
        "Reference number must be at most 150 characters";
    }

    if (
      isValidAmount(booking_amount) &&
      Number(booking_amount) > 0 &&
      payment_method !== "cash" &&
      !isPositiveId(account_id)
    ) {
      errors.account_id =
        "A bank account is required for non-cash token payments";
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
        payment_method,
        account_id: account_id ?? null,
        payment_date: payment_date || null,
        reference_number: reference_number?.trim() || null,
      },
      req.user?.id ?? null,
      getIdempotencyKey(req),
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

async function confirmBooking(req, res, next) {
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
      payment_method = "cash",
      account_id,
      payment_date,
      reference_number,
    } = req.body;

    if (!bookingUuid || !UUID_REGEX.test(bookingUuid)) {
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
    ];

    if (["milestone", "custom"].includes(frequency)) {
      return res.status(400).json({
        success: false,
        message:
          "Milestone and custom payment plans require an explicit due date for every installment and are not supported by this endpoint yet.",
      });
    }

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

    if (!PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid payment method",
      });
    }

    if (
      payment_date !== undefined &&
      payment_date !== null &&
      payment_date !== "" &&
      !isValidDate(payment_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid payment date in YYYY-MM-DD format",
      });
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      return res.status(400).json({
        success: false,
        message: "Reference number must be at most 150 characters",
      });
    }

    if (
      Number(down_payment) > 0 &&
      payment_method !== "cash" &&
      !isPositiveId(account_id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A bank account is required for non-cash down-payment receipts",
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
        payment_method,
        account_id: account_id ?? null,
        payment_date: payment_date || null,
        reference_number: reference_number?.trim() || null,
      },
      userId,
    );

    return res.status(200).json({
      success: true,
      message: "Booking confirmed successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelBooking(req, res, next) {
  try {
    const { bookingUuid } = req.params;

    if (!bookingUuid || !UUID_REGEX.test(bookingUuid)) {
      return res.status(400).json({
        success: false,
        message: "A valid booking UUID is required",
      });
    }

    const body = req.body || {};
    const {
      reason = "",
      refund_token = false,
      refund_method,
      refund_account_id,
      refund_date,
      reference_number,
    } = body;

    if (typeof reason !== "string" || reason.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason must be at most 5000 characters",
      });
    }

    if (typeof refund_token !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "refund_token must be true or false",
      });
    }

    if (
      refund_method !== undefined &&
      refund_method !== null &&
      !PAYMENT_METHODS.includes(refund_method)
    ) {
      return res.status(400).json({
        success: false,
        message: "Select a valid refund method",
      });
    }

    if (
      refund_token &&
      refund_method !== undefined &&
      refund_method !== "cash" &&
      !isPositiveId(refund_account_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "A bank account is required for non-cash refunds",
      });
    }

    if (
      refund_date !== undefined &&
      refund_date !== null &&
      refund_date !== "" &&
      !isValidDate(refund_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid refund date in YYYY-MM-DD format",
      });
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      return res.status(400).json({
        success: false,
        message: "Reference number must be at most 150 characters",
      });
    }

    const result = await bookingService.cancelBooking(
      bookingUuid,
      {
        reason: reason.trim(),
        refund_token,
        refund_method: refund_method || null,
        refund_account_id: refund_account_id ?? null,
        refund_date: refund_date || null,
        reference_number: reference_number?.trim() || null,
      },
      req.user?.id ?? null,
    );

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBooking,
  getBookings,
  confirmBooking,
  cancelBooking,
};
