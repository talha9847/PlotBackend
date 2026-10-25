"use strict";

const { query } = require("../config/db");

function toNumber(value) {
  return Number(value ?? 0);
}

/**
 * Compare every account's opening balance plus source-ledger entries against
 * the derived balance exposed by v_unified_transactions. The two calculations
 * are intentionally independent: a difference means the view and the domain
 * tables have drifted apart.
 */
async function reconcileAccounts() {
  const result = await query(`
    WITH ledger_entries AS (
      SELECT account_id, amount AS delta
      FROM payments
      WHERE status IN ('completed', 'partially_refunded', 'refunded')

      UNION ALL

      SELECT
        account_id,
        CASE
          WHEN transaction_type = 'income' THEN amount
          ELSE -amount
        END AS delta
      FROM financial_transactions
      WHERE status = 'posted'
        AND deleted_at IS NULL

      UNION ALL

      SELECT from_account_id AS account_id, -amount AS delta
      FROM account_transfers

      UNION ALL

      SELECT to_account_id AS account_id, amount AS delta
      FROM account_transfers

      UNION ALL

      SELECT account_id, -amount AS delta
      FROM payment_reversals
      WHERE status = 'completed'
    ),
    ledger AS (
      SELECT account_id, SUM(delta) AS ledger_delta
      FROM ledger_entries
      GROUP BY account_id
    ),
    view_ledger AS (
      SELECT
        account_id,
        SUM(
          CASE WHEN direction = 'credit' THEN amount ELSE -amount END
        ) AS view_delta
      FROM v_unified_transactions
      WHERE counts_as_balance
      GROUP BY account_id
    )
    SELECT
      a.id,
      a.uuid,
      a.account_name,
      a.bank_name,
      a.account_type,
      a.is_active,
      a.opening_balance,
      ROUND(a.opening_balance + COALESCE(l.ledger_delta, 0), 2)
        AS ledger_balance,
      ROUND(a.opening_balance + COALESCE(v.view_delta, 0), 2)
        AS computed_balance,
      ROUND(
        COALESCE(v.view_delta, 0) - COALESCE(l.ledger_delta, 0),
        2
      ) AS discrepancy
    FROM accounts a
    LEFT JOIN ledger l ON l.account_id = a.id
    LEFT JOIN view_ledger v ON v.account_id = a.id
    ORDER BY
      CASE WHEN a.account_type = 'cash' THEN 0 ELSE 1 END,
      a.account_name ASC
  `);

  const accounts = result.rows.map((row) => ({
    ...row,
    opening_balance: toNumber(row.opening_balance),
    ledger_balance: toNumber(row.ledger_balance),
    computed_balance: toNumber(row.computed_balance),
    discrepancy: toNumber(row.discrepancy),
  }));

  return {
    accounts,
    mismatches: accounts.filter((account) => account.discrepancy !== 0),
  };
}

/**
 * Validate that each non-cancelled plan's remaining balance equals the total
 * unpaid scheduled principal. Late fees are excluded on purpose: the plan
 * balance tracks principal only.
 */
async function reconcilePlans() {
  const result = await query(`
    SELECT
      cp.id,
      cp.uuid,
      cp.booking_id,
      cp.status,
      cp.remaining_balance,
      COALESCE(
        SUM(i.amount_due - i.amount_paid) FILTER (
          WHERE i.status NOT IN ('waived', 'cancelled')
        ),
        0
      ) AS scheduled_unpaid
    FROM customer_plans cp
    LEFT JOIN installments i ON i.customer_plan_id = cp.id
    WHERE cp.status IN ('active', 'completed')
    GROUP BY
      cp.id,
      cp.uuid,
      cp.booking_id,
      cp.status,
      cp.remaining_balance
    HAVING ROUND(
      cp.remaining_balance - COALESCE(
        SUM(i.amount_due - i.amount_paid) FILTER (
          WHERE i.status NOT IN ('waived', 'cancelled')
        ),
        0
      ),
      2
    ) <> 0
    ORDER BY cp.id ASC
  `);

  const plans = result.rows.map((row) => ({
    ...row,
    remaining_balance: toNumber(row.remaining_balance),
    scheduled_unpaid: toNumber(row.scheduled_unpaid),
    discrepancy: Number(
      (toNumber(row.remaining_balance) - toNumber(row.scheduled_unpaid)).toFixed(
        2,
      ),
    ),
  }));

  return { plans, mismatches: plans };
}

/**
 * Validate the refund lifecycle. The original payment status must match the
 * sum of its active refunds, and a refund can never exceed its payment.
 */
async function reconcileRefunds() {
  const result = await query(`
    SELECT
      p.id,
      p.uuid,
      p.payment_number,
      p.amount,
      p.status,
      COALESCE(
        SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
        0
      ) AS refunded_amount,
      CASE
        WHEN COALESCE(
          SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
          0
        ) = 0 THEN 'completed'
        WHEN COALESCE(
          SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
          0
        ) >= p.amount THEN 'refunded'
        ELSE 'partially_refunded'
      END AS expected_status
    FROM payments p
    LEFT JOIN payment_reversals r ON r.original_payment_id = p.id
    GROUP BY p.id, p.uuid, p.payment_number, p.amount, p.status
    HAVING (
      p.status IN ('completed', 'partially_refunded', 'refunded')
      AND p.status <> CASE
        WHEN COALESCE(
          SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
          0
        ) = 0 THEN 'completed'
        WHEN COALESCE(
          SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
          0
        ) >= p.amount THEN 'refunded'
        ELSE 'partially_refunded'
      END
    )
    OR (
      p.status NOT IN ('completed', 'partially_refunded', 'refunded')
      AND COALESCE(
        SUM(r.amount) FILTER (WHERE r.status IN ('pending', 'completed')),
        0
      ) > 0
    )
    ORDER BY p.id ASC
  `);

  const refunds = result.rows.map((row) => ({
    ...row,
    amount: toNumber(row.amount),
    refunded_amount: toNumber(row.refunded_amount),
  }));

  return { refunds, mismatches: refunds };
}

async function reconcileFinance() {
  const [accountResult, planResult, refundResult] = await Promise.all([
    reconcileAccounts(),
    reconcilePlans(),
    reconcileRefunds(),
  ]);

  const totalFindings =
    accountResult.mismatches.length +
    planResult.mismatches.length +
    refundResult.mismatches.length;

  return {
    generatedAt: new Date().toISOString(),
    accounts: accountResult.accounts,
    accountMismatches: accountResult.mismatches,
    planMismatches: planResult.mismatches,
    refundMismatches: refundResult.mismatches,
    totalFindings,
  };
}

module.exports = {
  reconcileFinance,
  reconcileAccounts,
  reconcilePlans,
  reconcileRefunds,
};
