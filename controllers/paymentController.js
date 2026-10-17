const paymentService = require("../services/paymentService");

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
    } = req.body;


    // Request validation belongs in the controller.
    if (!amount || Number(amount) <= 0 || !Number.isFinite(Number(amount))) {
      return res.status(400).json({
        success: false,
        message: "A valid payment amount is required.",
      });
    }

    if (!booking_id || !customer_id || !installment_id || !installment_uuid) {
      return res.status(400).json({
        success: false,
        message: "Booking, customer, and installment details are required.",
      });
    }

    if (!paid_at || !payment_method) {
      return res.status(400).json({
        success: false,
        message: "Payment date and payment method are required.",
      });
    }

    const result = await paymentService.receivePayment(
      {
        amount: String(amount),
        booking_id: Number(booking_id),
        customer_id: Number(customer_id),
        installment_id: Number(installment_id),
        installment_uuid,
        notes,
        paid_at,
        payment_method,
      },
      req.user?.id,
    );

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  receivePayment,
};
