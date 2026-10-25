"use strict";

const { getNextDueDate } = require("../services/paymentService");

const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "reserved",
  "confirmed",
  "completed",
];

function toNumber(value) {
  return Number(value ?? 0);
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function resolveInstallmentStatus(row, amountDue, today) {
  const amountPaid = toNumber(row.amount_paid);
  const lateFee = toNumber(row.late_fee);

  if (amountPaid >= roundMoney(amountDue + lateFee)) {
    return "paid";
  }

  if (String(row.due_date).slice(0, 10) < today) {
    return "overdue";
  }

  if (amountPaid > 0) {
    return "partially_paid";
  }

  return "pending";
}

async function backfillReceipts(client, cashAccountId) {
  // A legacy payment that was recorded before migration 019 was classified as
  // an installment. If any such payment exists for a booking, adding a token or
  // down-payment receipt could duplicate money that is already recorded. Those
  // ambiguous bookings are intentionally skipped and reported by
  // scripts/audit-finance-backfill.js for manual review.
  const tokenResult = await client.query(
    `
    INSERT INTO payments (
      payment_number,
      booking_id,
      customer_id,
      installment_id,
      account_id,
      payment_method,
      amount,
      currency_code,
      payment_date,
      transaction_reference,
      received_by,
      status,
      payment_purpose,
      notes,
      created_at,
      updated_at
    )
    SELECT
      'PAY-LEGACY-TKN-' || b.uuid,
      b.id,
      b.customer_id,
      NULL,
      $1,
      'cash',
      b.booking_amount,
      'INR',
      COALESCE(b.booking_date::timestamptz, b.created_at),
      'LEGACY-TOKEN',
      b.created_by,
      'completed',
      'booking_token',
      'Auto-generated legacy booking token receipt. Assumed Cash in Hand because the original payment method was not recorded.',
      b.created_at,
      NOW()
    FROM bookings b
    WHERE b.booking_amount > 0
      AND b.status = ANY($2::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.booking_id = b.id
      )
    ON CONFLICT (payment_number) DO NOTHING
  `,
    [cashAccountId, ACTIVE_BOOKING_STATUSES],
  );

  const downPaymentResult = await client.query(
    `
    INSERT INTO payments (
      payment_number,
      booking_id,
      customer_id,
      installment_id,
      account_id,
      payment_method,
      amount,
      currency_code,
      payment_date,
      transaction_reference,
      received_by,
      status,
      payment_purpose,
      notes,
      created_at,
      updated_at
    )
    SELECT
      'PAY-LEGACY-DP-' || b.uuid,
      cp.booking_id,
      cp.customer_id,
      NULL,
      COALESCE(token.account_id, $1),
      COALESCE(token.payment_method, 'cash'),
      cp.down_payment,
      'INR',
      cp.created_at,
      'LEGACY-DOWN-PAYMENT',
      cp.created_by,
      'completed',
      'down_payment',
      CASE
        WHEN token.id IS NULL THEN
          'Auto-generated legacy down payment receipt. Assumed Cash in Hand because the original payment method was not recorded.'
        ELSE
          'Auto-generated legacy down payment receipt. Method and account copied from the booking token receipt.'
      END,
      cp.created_at,
      NOW()
    FROM customer_plans cp
    INNER JOIN bookings b ON b.id = cp.booking_id
    LEFT JOIN LATERAL (
      SELECT p.id, p.account_id, p.payment_method
      FROM payments p
      WHERE p.booking_id = cp.booking_id
        AND p.payment_purpose = 'booking_token'
      ORDER BY p.id ASC
      LIMIT 1
    ) token ON TRUE
    WHERE cp.down_payment > 0
      AND cp.status IN ('active', 'completed')
      AND b.status NOT IN ('cancelled', 'refunded')
      AND NOT EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.booking_id = cp.booking_id
          AND p.payment_purpose = 'down_payment'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.booking_id = cp.booking_id
          AND p.payment_purpose = 'installment'
          AND p.status NOT IN ('cancelled', 'failed')
      )
    ON CONFLICT (payment_number) DO NOTHING
  `,
    [cashAccountId],
  );

  return {
    tokenReceipts: tokenResult.rowCount,
    downPaymentReceipts: downPaymentResult.rowCount,
  };
}

async function repairSchedules(client) {
  const plansResult = await client.query(`
    SELECT
      cp.id,
      cp.installment_count,
      cp.frequency,
      cp.remaining_balance,
      TO_CHAR(cp.start_date, 'YYYY-MM-DD') AS start_date
    FROM customer_plans cp
    WHERE cp.status = 'active'
    ORDER BY cp.id ASC
  `);

  const today = new Date().toISOString().slice(0, 10);
  let repairedPlans = 0;
  const skippedPlans = [];

  for (const plan of plansResult.rows) {
    const installmentCount = Number(plan.installment_count);
    const planId = Number(plan.id);

    const installmentsResult = await client.query(
      `
      SELECT
        id,
        installment_number,
        TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
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

    const byNumber = new Map(
      installmentsResult.rows.map((row) => [Number(row.installment_number), row]),
    );
    const activeRows = installmentsResult.rows.filter(
      (row) => !["waived", "cancelled"].includes(row.status),
    );

    const existingDue = activeRows.reduce(
      (sum, row) => sum + toNumber(row.amount_due),
      0,
    );
    // Remaining balance tracks principal only. Late fees are tracked on the
    // installment row, so exclude any late-fee portion from paid principal.
    const totalPaidPrincipal = activeRows.reduce(
      (sum, row) =>
        sum +
        Math.min(toNumber(row.amount_paid), toNumber(row.amount_due)),
      0,
    );
    const targetTotalDue = roundMoney(
      toNumber(plan.remaining_balance) + totalPaidPrincipal,
    );

    let missingAmount = roundMoney(targetTotalDue - existingDue);
    const missingNumbers = [];

    for (let number = 1; number <= installmentCount; number += 1) {
      if (!byNumber.has(number)) {
        missingNumbers.push(number);
      }
    }

    if (missingNumbers.length === 0) {
      if (Math.abs(missingAmount) < 0.005) {
        continue;
      }

      if (activeRows.length === 0) {
        skippedPlans.push({
          planId,
          reason: "No active installments available for balance adjustment",
        });
        continue;
      }

      // Adjust the latest installment. Prefer one that still has unpaid value so
      // a positive correction does not silently mark a paid row as unpaid unless
      // that is the only way to represent an under-allocated plan.
      const candidates = [...activeRows].sort(
        (a, b) =>
          Number(b.installment_number) - Number(a.installment_number),
      );
      const target =
        candidates.find(
          (row) =>
            toNumber(row.amount_paid) <
            roundMoney(toNumber(row.amount_due) + toNumber(row.late_fee)),
        ) || candidates[0];

      let nextAmountDue = roundMoney(
        toNumber(target.amount_due) + missingAmount,
      );

      if (nextAmountDue < 0) {
        nextAmountDue = 0;
      }

      if (missingAmount < 0) {
        const floor = Math.max(
          0,
          roundMoney(toNumber(target.amount_paid) - toNumber(target.late_fee)),
        );

        if (nextAmountDue < floor) {
          skippedPlans.push({
            planId,
            reason:
              "Existing schedule is over-allocated and cannot be reduced without conflicting with paid amounts",
          });
          continue;
        }
      }

      const nextStatus = resolveInstallmentStatus(
        target,
        nextAmountDue,
        today,
      );

      await client.query(
        `
        UPDATE installments
        SET amount_due = $2,
            status = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
        [target.id, nextAmountDue, nextStatus],
      );

      repairedPlans += 1;
      continue;
    }

    if (missingAmount < 0) {
      // The existing rows already exceed the plan balance. Reduce unpaid value
      // first, then allocate whatever remains across the missing rows.
      let reduction = Math.abs(missingAmount);
      const reductionCandidates = activeRows
        .filter(
          (row) => toNumber(row.amount_paid) < toNumber(row.amount_due),
        )
        .sort(
          (a, b) =>
            Number(b.installment_number) - Number(a.installment_number),
        );

      for (const row of reductionCandidates) {
        if (reduction <= 0) break;

        const reducible = roundMoney(
          toNumber(row.amount_due) - toNumber(row.amount_paid),
        );
        const take = Math.min(reducible, reduction);
        const nextAmountDue = roundMoney(toNumber(row.amount_due) - take);
        const nextStatus = resolveInstallmentStatus(
          row,
          nextAmountDue,
          today,
        );

        await client.query(
          `
          UPDATE installments
          SET amount_due = $2,
              status = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
          [row.id, nextAmountDue, nextStatus],
        );

        row.amount_due = nextAmountDue;
        reduction = roundMoney(reduction - take);
      }

      const adjustedDue = activeRows.reduce(
        (sum, row) => sum + toNumber(row.amount_due),
        0,
      );
      missingAmount = roundMoney(targetTotalDue - adjustedDue);

      if (missingAmount < 0) {
        skippedPlans.push({
          planId,
          reason:
            "Existing paid installments exceed the plan balance; manual reconciliation required",
        });
        continue;
      }
    }

    const baseAmount =
      Math.floor((missingAmount / missingNumbers.length) * 100) / 100;
    const finalAmount = roundMoney(
      missingAmount - (missingNumbers.length - 1) * baseAmount,
    );

    for (let index = 0; index < missingNumbers.length; index += 1) {
      const installmentNumber = missingNumbers[index];

      let previousDueDate = plan.start_date;

      for (let previous = installmentNumber - 1; previous >= 1; previous -= 1) {
        const previousRow = byNumber.get(previous);

        if (previousRow) {
          previousDueDate = previousRow.due_date;
          break;
        }
      }

      const nextDueDate =
        installmentNumber === 1
          ? plan.start_date
          : getNextDueDate(previousDueDate, plan.frequency) ||
            previousDueDate;

      const amountDue =
        index === missingNumbers.length - 1 ? finalAmount : baseAmount;
      const frequencyNote = ["milestone", "custom"].includes(plan.frequency)
        ? `Auto-generated schedule row. Verify the due date for ${plan.frequency} frequency.`
        : null;

      await client.query(
        `
        INSERT INTO installments (
          customer_plan_id,
          installment_number,
          description,
          due_date,
          amount_due,
          amount_paid,
          status,
          notes
        )
        VALUES (
          $1, $2, $3, $4, $5, 0,
          CASE WHEN $4::date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
          $6
        )
        ON CONFLICT (customer_plan_id, installment_number) DO NOTHING
      `,
        [
          planId,
          installmentNumber,
          `Installment ${installmentNumber}`,
          nextDueDate,
          amountDue,
          frequencyNote,
        ],
      );

      byNumber.set(installmentNumber, {
        installment_number: installmentNumber,
        due_date: nextDueDate,
        amount_due: amountDue,
        amount_paid: 0,
        late_fee: 0,
        status: nextDueDate < today ? "overdue" : "pending",
      });
    }

    repairedPlans += 1;
  }

  return { repairedPlans, skippedPlans };
}

async function up(client) {
  const cashAccountResult = await client.query(`
    SELECT id
    FROM accounts
    WHERE account_type = 'cash'
      AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
  `);

  if (cashAccountResult.rowCount === 0) {
    throw new Error(
      "Cannot backfill receipts: No active cash account found. Ensure migration 016 has run.",
    );
  }

  const cashAccountId = cashAccountResult.rows[0].id;

  const assumptionResult = await client.query(
    `
    SELECT
      (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.booking_amount > 0
          AND b.status = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM payments p WHERE p.booking_id = b.id
          )
      )::int AS token_cash_assumptions,
      (
        SELECT COUNT(*)
        FROM customer_plans cp
        INNER JOIN bookings b ON b.id = cp.booking_id
        WHERE cp.down_payment > 0
          AND cp.status IN ('active', 'completed')
          AND b.status NOT IN ('cancelled', 'refunded')
          AND NOT EXISTS (
            SELECT 1 FROM payments p WHERE p.booking_id = cp.booking_id
          )
      )::int AS down_payment_cash_assumptions
  `,
    [ACTIVE_BOOKING_STATUSES],
  );

  const receiptSummary = await backfillReceipts(client, cashAccountId);
  const scheduleSummary = await repairSchedules(client);

  // Plans whose balance reached zero and whose schedule is fully settled should
  // not remain active after the repair pass.
  await client.query(`
    UPDATE customer_plans cp
    SET status = 'completed',
        updated_at = NOW()
    WHERE cp.status = 'active'
      AND cp.remaining_balance = 0
      AND EXISTS (
        SELECT 1
        FROM installments i
        WHERE i.customer_plan_id = cp.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM installments i
        WHERE i.customer_plan_id = cp.id
          AND i.status NOT IN ('waived', 'cancelled')
          AND i.amount_paid < i.amount_due + i.late_fee
      )
  `);

  console.log(
    `Legacy receipt backfill: ${receiptSummary.tokenReceipts} token, ${receiptSummary.downPaymentReceipts} down-payment receipt(s).`,
  );
  console.log(
    `Schedule repair: ${scheduleSummary.repairedPlans} plan(s) repaired.`,
  );

  if (scheduleSummary.skippedPlans.length > 0) {
    console.warn(
      "Plans needing manual reconciliation:",
      scheduleSummary.skippedPlans,
    );
  }

  const assumptions = assumptionResult.rows[0];

  if (
    assumptions.token_cash_assumptions > 0 ||
    assumptions.down_payment_cash_assumptions > 0
  ) {
    console.warn(
      `Backfill assumed Cash in Hand for ${assumptions.token_cash_assumptions} token and ${assumptions.down_payment_cash_assumptions} down-payment receipt(s) with no prior payment method. Run scripts/audit-finance-backfill.js to review.`,
    );
  }
}

module.exports = { up };
