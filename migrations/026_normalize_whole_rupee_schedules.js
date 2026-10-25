"use strict";

const { splitInstallmentAmounts } = require("../services/installmentAmounts");

const NORMALIZABLE_INSTALLMENT_STATUSES = new Set(["pending", "overdue"]);

function toNumber(value) {
  return Number(value ?? 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function up(client) {
  const plansResult = await client.query(`
    SELECT
      cp.id,
      cp.installment_count,
      cp.remaining_balance
    FROM customer_plans cp
    INNER JOIN bookings b ON b.id = cp.booking_id
    WHERE cp.status = 'active'
      AND b.status NOT IN ('cancelled', 'refunded')
    ORDER BY cp.id ASC
  `);

  let normalizedPlans = 0;
  let normalizedInstallments = 0;
  const skippedPlans = [];

  for (const plan of plansResult.rows) {
    const planId = Number(plan.id);
    const installmentCount = Number(plan.installment_count);
    const balance = Number(plan.remaining_balance);

    const skip = (reason) => {
      skippedPlans.push({ planId, reason });
    };

    if (
      !Number.isSafeInteger(installmentCount) ||
      installmentCount <= 0 ||
      !Number.isSafeInteger(balance) ||
      balance < installmentCount
    ) {
      skip("Plan balance and installment count must be whole numbers");
      continue;
    }

    const installmentsResult = await client.query(
      `
      SELECT
        id,
        installment_number,
        amount_due,
        amount_paid,
        late_fee,
        status
      FROM installments
      WHERE customer_plan_id = $1
      ORDER BY installment_number ASC
    `,
      [planId],
    );

    const installments = installmentsResult.rows;
    const hasFractionalAmount = installments.some(
      (row) => !Number.isInteger(toNumber(row.amount_due)),
    );

    // Plans that already contain only whole-rupee rows need no attention.
    if (!hasFractionalAmount) {
      continue;
    }

    if (installments.length !== installmentCount) {
      skip("Installment row count does not match the plan");
      continue;
    }

    const installmentNumbers = installments.map((row) =>
      Number(row.installment_number),
    );
    const hasCompleteSequence =
      new Set(installmentNumbers).size === installmentCount &&
      installmentNumbers.every(
        (number) => number >= 1 && number <= installmentCount,
      );

    if (!hasCompleteSequence) {
      skip("Installment numbers are incomplete or out of sequence");
      continue;
    }

    if (
      installments.some(
        (row) =>
          !NORMALIZABLE_INSTALLMENT_STATUSES.has(row.status) ||
          toNumber(row.amount_paid) !== 0 ||
          toNumber(row.late_fee) !== 0,
      )
    ) {
      skip("Schedule has payment history, late fees, or special statuses");
      continue;
    }

    const totalDue = installments.reduce(
      (sum, row) => sum + toNumber(row.amount_due),
      0,
    );

    if (Math.abs(roundMoney(totalDue) - balance) > 0.005) {
      skip("Schedule total does not match the plan balance");
      continue;
    }

    const linkedPayments = await client.query(
      `
      SELECT 1
      FROM payments p
      INNER JOIN installments i ON i.id = p.installment_id
      WHERE i.customer_plan_id = $1
      LIMIT 1
    `,
      [planId],
    );

    if (linkedPayments.rowCount > 0) {
      skip("Schedule has linked payment records");
      continue;
    }

    const amounts = splitInstallmentAmounts(balance, installmentCount);
    const needsUpdate = installments.some(
      (row, index) => toNumber(row.amount_due) !== amounts[index],
    );

    if (!needsUpdate) {
      continue;
    }

    for (let index = 0; index < installments.length; index += 1) {
      await client.query(
        `
        UPDATE installments
        SET amount_due = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
        [installments[index].id, amounts[index]],
      );
    }

    normalizedPlans += 1;
    normalizedInstallments += installments.length;
  }

  console.log(
    `Whole-rupee schedule normalization: ${normalizedPlans} plan(s), ${normalizedInstallments} installment(s) updated.`,
  );

  if (skippedPlans.length > 0) {
    console.warn(
      "Plans skipped during whole-rupee normalization:",
      skippedPlans,
    );
  }
}

module.exports = { up };
