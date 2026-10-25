const { pool } = require("../config/db.js");
const {
  resolveAccount,
  assertSufficientBalance,
  generateSequenceNumber,
  findIdempotentResource,
  recordIdempotencyKey,
  isIdempotencyViolation,
} = require("./financeService");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};
const getNextDueDate = (currentDate, frequency) => {
  if (!currentDate || typeof currentDate !== "string") {
    return null;
  }

  const dateString = currentDate.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Validate the actual calendar date.
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const monthOffsets = {
    monthly: 1,
    quarterly: 3,
    half_yearly: 6,
    yearly: 12,
  };

  if (frequency === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  }

  const monthOffset = monthOffsets[frequency];

  if (!monthOffset) {
    return null;
  }

  const target = new Date(Date.UTC(year, month - 1 + monthOffset, 1));

  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));

  return target.toISOString().slice(0, 10);
};

const generatePaymentNumber = async (client, year) => {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [71341, year]);

  const result = await client.query(
    `SELECT payment_number
     FROM payments
     WHERE payment_number LIKE $1
     ORDER BY id DESC
     LIMIT 1`,
    [`PAY-${year}-%`],
  );

  const lastPaymentNumber = result.rows[0]?.payment_number;
  const lastSequence = lastPaymentNumber
    ? Number(lastPaymentNumber.split("-").pop())
    : 0;

  if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
    throw createError("Unable to generate payment number.", 500);
  }

  return `PAY-${year}-${String(lastSequence + 1).padStart(4, "0")}`;
};

async function getPaymentByUuid(uuid) {
  const result = await pool.query(
    "SELECT * FROM payments WHERE uuid = $1 LIMIT 1",
    [uuid],
  );

  return result.rows[0] || null;
}

/**
 * Insert a refund row and move the original payment into the matching refund
 * status. The caller must already hold a row lock on the payment.
 */
async function applyRefund(client, payment, data, createdBy) {
  const reason = String(data.reason || "").trim();

  if (!reason) {
    throw createError("A refund reason is required.", 400);
  }

  if (reason.length > 5000) {
    throw createError("Refund reason cannot exceed 5000 characters.", 400);
  }

  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createError("A valid refund amount is required.", 400);
  }

  const previousResult = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS refunded
     FROM payment_reversals
     WHERE original_payment_id = $1
       AND status IN ('pending', 'completed')`,
    [payment.id],
  );

  const previouslyRefunded = Number(previousResult.rows[0].refunded ?? 0);
  const paymentAmount = Number(payment.amount);
  const remaining = Number(
    (paymentAmount - previouslyRefunded).toFixed(2),
  );
  const refundAmount = Number(amount.toFixed(2));

  if (refundAmount > remaining) {
    throw createError(
      `Refund cannot exceed the refundable balance of ${remaining.toFixed(2)}.`,
      409,
    );
  }

  const method = data.payment_method || payment.payment_method;
  const account = await resolveAccount(client, {
    paymentMethod: method,
    accountId: data.account_id ?? payment.account_id,
    lock: false,
  });

  await assertSufficientBalance(client, {
    accountId: account.id,
    amount: refundAmount,
  });

  const refundDate = data.refund_date
    ? String(data.refund_date).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const refundNumber = await generateSequenceNumber(client, {
    source: "payment_reversals",
    prefix: "RFD",
    year: Number(refundDate.slice(0, 4)),
  });

  const refundResult = await client.query(
    `INSERT INTO payment_reversals (
       reversal_number,
       original_payment_id,
       reversal_type,
       amount,
       account_id,
       reason,
       status,
       method,
       reference_number,
       reversal_date,
       created_by
     )
     VALUES (
       $1, $2, 'refund', $3, $4, $5, 'completed', $6, $7,
       $8::date::timestamptz, $9
     )
     RETURNING *`,
    [
      refundNumber,
      payment.id,
      refundAmount,
      account.id,
      reason,
      method,
      data.reference_number?.trim() || null,
      refundDate,
      createdBy || null,
    ],
  );

  const totalRefunded = Number(
    (previouslyRefunded + refundAmount).toFixed(2),
  );

  const paymentResult = await client.query(
    `UPDATE payments
     SET status = CASE
           WHEN $2::numeric >= amount THEN 'refunded'
           ELSE 'partially_refunded'
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payment.id, totalRefunded],
  );

  return {
    refund: refundResult.rows[0],
    payment: paymentResult.rows[0],
    refunded_total: totalRefunded,
    remaining_refundable: Number(
      (paymentAmount - totalRefunded).toFixed(2),
    ),
  };
}

const receivePayment = async (data, receivedBy, idempotencyKey = null) => {
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
  } = data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingUuid = await findIdempotentResource(
      client,
      idempotencyKey,
      "payment.received",
    );

    if (existingUuid) {
      await client.query("ROLLBACK");
      const existingPayment = await getPaymentByUuid(existingUuid);

      if (existingPayment) {
        return {
          payment: existingPayment,
          idempotent_replay: true,
        };
      }
    }

    const installmentResult = await client.query(
      `SELECT
            i.id,
            i.uuid,
            i.customer_plan_id,
            i.installment_number,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
            i.amount_due,
            i.amount_paid,
            i.late_fee,
            i.status AS installment_status,
            i.amount_due + i.late_fee - i.amount_paid AS outstanding_balance,
            i.due_date <= CURRENT_DATE AS is_due,
            cp.id AS plan_id,
            cp.customer_id,
            cp.booking_id,
            cp.installment_count,
            cp.frequency,
            cp.remaining_balance,
            cp.status AS plan_status
        FROM installments i
        INNER JOIN customer_plans cp
            ON cp.id = i.customer_plan_id
        WHERE i.id = $1
            AND i.uuid = $2
            AND cp.booking_id = $3
            AND cp.customer_id = $4
        FOR UPDATE OF i, cp`,
      [installment_id, installment_uuid, booking_id, customer_id],
    );

    if (installmentResult.rowCount === 0) {
      throw createError(
        "Installment not found or does not belong to this booking and customer.",
        404,
      );
    }

    const installment = installmentResult.rows[0];

    if (installment.plan_status !== "active") {
      throw createError("This customer payment plan is not active.");
    }

    if (
      ["paid", "waived", "cancelled"].includes(installment.installment_status)
    ) {
      throw createError(
        `Cannot receive payment for an installment with status "${installment.installment_status}".`,
      );
    }

    const balanceResult = await client.query(
      `SELECT
         $1::numeric <= $2::numeric AS is_valid,
         $2::numeric > 0 AS has_balance`,
      [amount, installment.outstanding_balance],
    );

    const balance = balanceResult.rows[0];

    if (!balance.has_balance) {
      throw createError("This installment has no outstanding balance.");
    }

    if (!balance.is_valid) {
      throw createError(
        `Payment cannot exceed the outstanding balance of ${installment.outstanding_balance}.`,
      );
    }

    const account = await resolveAccount(client, {
      paymentMethod: payment_method,
      accountId: account_id,
    });

    const paymentYear = Number(paid_at.slice(0, 4));
    const paymentNumber = await generatePaymentNumber(client, paymentYear);

    const paymentResult = await client.query(
      `INSERT INTO payments (
         payment_number,
         booking_id,
         customer_id,
         installment_id,
         payment_method,
         amount,
         payment_date,
         received_by,
         status,
         payment_purpose,
         notes,
         account_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date::timestamptz, $8, 'completed', 'installment', $9, $10
       )
       RETURNING *`,
      [
        paymentNumber,
        booking_id,
        customer_id,
        installment.id,
        payment_method,
        amount,
        paid_at,
        receivedBy || null,
        notes?.trim() || null,
        account.id,
      ],
    );

    const updatedInstallmentResult = await client.query(
      `UPDATE installments
       SET
         amount_paid = amount_paid + $2::numeric,
         status = CASE
           WHEN amount_paid + $2::numeric >= amount_due + late_fee
             THEN 'paid'
           WHEN due_date < CURRENT_DATE
             THEN 'overdue'
           ELSE 'partially_paid'
         END,
         paid_at = CASE
           WHEN amount_paid + $2::numeric >= amount_due + late_fee
             THEN $3::date::timestamptz
           ELSE paid_at
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [installment.id, amount, paid_at],
    );

    const updatedInstallment = updatedInstallmentResult.rows[0];

    const planUpdateResult = await client.query(
      `UPDATE customer_plans
       SET
         remaining_balance = GREATEST(
           remaining_balance - $2::numeric,
           0
         ),
         status = CASE
           WHEN remaining_balance - $2::numeric <= 0
             THEN 'completed'
           ELSE status
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         remaining_balance,
         installment_count,
         frequency,
         status`,
      [installment.plan_id, amount],
    );

    const updatedPlan = planUpdateResult.rows[0];

    // The complete schedule is generated when the booking is confirmed, and
    // migration 020 repairs legacy plans. Never create future installment rows
    // lazily from a payment receipt: doing so can duplicate or misallocate the
    // plan balance. Return the next existing row for backwards compatibility.
    const nextNumber = Number(installment.installment_number) + 1;
    const nextInstallmentResult = await client.query(
      `SELECT *
       FROM installments
       WHERE customer_plan_id = $1
         AND installment_number = $2
       LIMIT 1`,
      [installment.plan_id, nextNumber],
    );
    const nextInstallment = nextInstallmentResult.rows[0] || null;

    const outstandingResult = await client.query(
      `SELECT GREATEST(
         amount_due + late_fee - amount_paid,
         0
       ) AS outstanding_balance
       FROM installments
       WHERE id = $1`,
      [installment.id],
    );

    await recordIdempotencyKey(
      client,
      idempotencyKey,
      "payment.received",
      paymentResult.rows[0].uuid,
    );

    await client.query("COMMIT");

    return {
      payment: paymentResult.rows[0],
      installment: updatedInstallment,
      plan: updatedPlan,
      outstanding_balance: outstandingResult.rows[0].outstanding_balance,
      next_installment: nextInstallment,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Transaction rollback failed:", rollbackError);
    }

    if (isIdempotencyViolation(error) && idempotencyKey) {
      const existingResult = await pool.query(
        `SELECT p.*
         FROM idempotency_keys k
         INNER JOIN payments p ON p.uuid = k.resource_uuid
         WHERE k.key = $1
           AND k.scope = 'payment.received'
         LIMIT 1`,
        [idempotencyKey],
      );

      if (existingResult.rowCount > 0) {
        return {
          payment: existingResult.rows[0],
          idempotent_replay: true,
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
};

/**
 * Refund a receipt, partially or in full. Refunds are separate ledger rows;
 * the original payment is never edited or deleted.
 */
async function refundPayment(
  paymentUuid,
  data,
  createdBy,
  idempotencyKey = null,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingUuid = await findIdempotentResource(
      client,
      idempotencyKey,
      "payment.refund",
    );

    if (existingUuid) {
      await client.query("ROLLBACK");
      const existingResult = await pool.query(
        `SELECT r.*, p.uuid AS payment_uuid
         FROM payment_reversals r
         INNER JOIN payments p ON p.id = r.original_payment_id
         WHERE r.uuid = $1
         LIMIT 1`,
        [existingUuid],
      );

      if (existingResult.rowCount > 0) {
        return {
          refund: existingResult.rows[0],
          idempotent_replay: true,
        };
      }
    }

    const paymentResult = await client.query(
      `SELECT *
       FROM payments
       WHERE uuid = $1
       FOR UPDATE`,
      [paymentUuid],
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      throw createError("Payment not found.", 404);
    }

    if (!["completed", "partially_refunded"].includes(payment.status)) {
      throw createError(
        `Cannot refund a payment with status "${payment.status}".`,
        409,
      );
    }

    const result = await applyRefund(client, payment, data, createdBy);

    await recordIdempotencyKey(
      client,
      idempotencyKey,
      "payment.refund",
      result.refund.uuid,
    );

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Refund rollback failed:", rollbackError);
    }

    if (isIdempotencyViolation(error) && idempotencyKey) {
      const existingResult = await pool.query(
        `SELECT r.*, p.uuid AS payment_uuid
         FROM idempotency_keys k
         INNER JOIN payment_reversals r ON r.uuid = k.resource_uuid
         INNER JOIN payments p ON p.id = r.original_payment_id
         WHERE k.key = $1
           AND k.scope = 'payment.refund'
         LIMIT 1`,
        [idempotencyKey],
      );

      if (existingResult.rowCount > 0) {
        return {
          refund: existingResult.rows[0],
          idempotent_replay: true,
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  receivePayment,
  refundPayment,
  applyRefund,
  getPaymentByUuid,
  getNextDueDate,
  generatePaymentNumber,
};
