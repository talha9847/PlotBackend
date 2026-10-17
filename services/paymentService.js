const { pool } = require("../config/db.js");

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

const receivePayment = async (data, receivedBy) => {
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
         notes,
         account_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date::timestamptz, $8, 'completed', $9, $10
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
        account_id,
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
    const isFullyPaid = updatedInstallment.status === "paid";

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

    let nextInstallment = null;

    const shouldCreateNext =
      isFullyPaid ||
      (["partially_paid", "overdue"].includes(updatedInstallment.status) &&
        installment.is_due);

    const nextNumber = Number(installment.installment_number) + 1;
    if (
      shouldCreateNext &&
      updatedPlan.status === "active" &&
      nextNumber <= Number(updatedPlan.installment_count)
    ) {
      const nextDueDate = getNextDueDate(
        installment.due_date,
        updatedPlan.frequency,
      );

      if (nextDueDate) {
        const allocationResult = await client.query(
          `SELECT
              GREATEST(
                $1::numeric - COALESCE(
                    SUM(
                        GREATEST(i.amount_due - i.amount_paid, 0)
                        ),
                        0
                        ),
                        0
                        ) AS unallocated_balance
                        FROM installments i
                        WHERE i.customer_plan_id = $2
                        AND i.status NOT IN ('waived', 'cancelled')`,
          [updatedPlan.remaining_balance, installment.plan_id],
        );
        const nextAmountResult = await client.query(
          `SELECT LEAST(
                $1::numeric,
                $2::numeric
                ) AS next_amount`,
          [
            installment.amount_due,
            allocationResult.rows[0].unallocated_balance,
          ],
        );
        const nextAmount = nextAmountResult.rows[0].next_amount;
        const insertNextResult = await client.query(
          `INSERT INTO installments (
                customer_plan_id,
                installment_number,
                description,
                due_date,
                amount_due,
                amount_paid,
                status
                )
                SELECT $1, $2, $3, $4, $5::numeric, 0, 'pending'
                WHERE $5::numeric > 0
                ON CONFLICT (customer_plan_id, installment_number)
                DO NOTHING
                RETURNING *`,
          [
            installment.plan_id,
            nextNumber,
            `Installment ${nextNumber}`,
            nextDueDate,
            nextAmount,
          ],
        );
        nextInstallment = insertNextResult.rows[0] || null;
      }
    }

    const outstandingResult = await client.query(
      `SELECT GREATEST(
         amount_due + late_fee - amount_paid,
         0
       ) AS outstanding_balance
       FROM installments
       WHERE id = $1`,
      [installment.id],
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

    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  receivePayment,
};
