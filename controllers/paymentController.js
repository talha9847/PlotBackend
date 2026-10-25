"use strict";

const paymentService = require("../services/paymentService");
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
  Number(value) > 0 &&
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

async function receivePayment(req, res, next) {
  try {
    const {
      amount,
      booking_id,
      customer_id,
      installment_id,
      installment_uuid,
      notes,
      paid_at,
      payment_method,
      account_id,
    } = req.body || {};

    if (!isValidAmount(amount)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment amount is required.",
      });
    }

    if (
      !isPositiveId(booking_id) ||
      !isPositiveId(customer_id) ||
      !isPositiveId(installment_id) ||
      typeof installment_uuid !== "string" ||
      !UUID_REGEX.test(installment_uuid)
    ) {
      return res.status(400).json({
        success: false,
        message: "Booking, customer, and installment details are required.",
      });
    }

    if (!paid_at || !isValidDate(paid_at)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment date is required.",
      });
    }

    if (!PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment method is required.",
      });
    }

    // Cash always lands in the single Cash in Hand account. Non-cash methods
    // must name an explicit bank account.
    if (payment_method !== "cash" && !isPositiveId(account_id)) {
      return res.status(400).json({
        success: false,
        message: "A bank account is required for non-cash payments.",
      });
    }

    const result = await paymentService.receivePayment(
      {
        amount: String(amount),
        booking_id: Number(booking_id),
        account_id: isPositiveId(account_id) ? Number(account_id) : null,
        customer_id: Number(customer_id),
        installment_id: Number(installment_id),
        installment_uuid,
        notes,
        paid_at,
        payment_method,
      },
      req.user?.id,
      getIdempotencyKey(req),
    );

    return res.status(201).json({
      success: true,
      message: result.idempotent_replay
        ? "Payment was already recorded."
        : "Payment recorded successfully.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function refundPayment(req, res, next) {
  try {
    const { uuid } = req.params;

    if (!uuid || !UUID_REGEX.test(uuid)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment UUID is required",
      });
    }

    const body = req.body || {};
    const {
      amount,
      reason,
      payment_method,
      account_id,
      refund_date,
      reference_number,
    } = body;

    if (!isValidAmount(amount)) {
      return res.status(400).json({
        success: false,
        message: "A valid refund amount is required.",
      });
    }

    if (typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "A refund reason is required.",
      });
    }

    if (reason.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Refund reason cannot exceed 5000 characters.",
      });
    }

    if (
      payment_method !== undefined &&
      payment_method !== null &&
      !PAYMENT_METHODS.includes(payment_method)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid refund method is required.",
      });
    }

    if (
      payment_method !== undefined &&
      payment_method !== null &&
      payment_method !== "cash" &&
      !isPositiveId(account_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "A bank account is required for non-cash refunds.",
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
        message: "Enter a valid refund date in YYYY-MM-DD format.",
      });
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      return res.status(400).json({
        success: false,
        message: "Reference number must be at most 150 characters.",
      });
    }

    const result = await paymentService.refundPayment(
      uuid,
      {
        amount: String(amount),
        reason: reason.trim(),
        payment_method: payment_method || null,
        account_id: isPositiveId(account_id) ? Number(account_id) : null,
        refund_date: refund_date || null,
        reference_number: reference_number?.trim() || null,
      },
      req.user?.id ?? null,
      getIdempotencyKey(req),
    );

    return res.status(201).json({
      success: true,
      message: result.idempotent_replay
        ? "Refund was already recorded."
        : "Refund recorded successfully.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  receivePayment,
  refundPayment,
};
