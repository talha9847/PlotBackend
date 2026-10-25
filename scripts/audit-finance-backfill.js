"use strict";

require("dotenv").config();

const { query, pool } = require("../config/db");

const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "reserved",
  "confirmed",
  "completed",
];

async function runCheck(name, sql, params = []) {
  const result = await query(sql, params);

  return {
    name,
    count: result.rowCount,
    rows: result.rows,
  };
}

async function main() {
  const checks = [];

  checks.push(
    await runCheck(
      "Bookings with a token amount but no booking_token receipt",
      `
      SELECT
        b.id,
        b.uuid,
        b.booking_number,
        b.booking_amount,
        b.status
      FROM bookings b
      WHERE b.booking_amount > 0
        AND b.status = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.booking_id = b.id
            AND p.payment_purpose = 'booking_token'
        )
      ORDER BY b.id ASC
      `,
      [ACTIVE_BOOKING_STATUSES],
    ),
  );

  checks.push(
    await runCheck(
      "Duplicate token or down-payment receipts",
      `
      SELECT
        p.booking_id,
        p.payment_purpose,
        COUNT(*)::int AS receipt_count,
        SUM(p.amount) AS total_amount
      FROM payments p
      WHERE p.payment_purpose IN ('booking_token', 'down_payment')
      GROUP BY p.booking_id, p.payment_purpose
      HAVING COUNT(*) > 1
      ORDER BY p.booking_id ASC, p.payment_purpose ASC
      `,
    ),
  );

  checks.push(
    await runCheck(
      "Active plans with a down payment but no down_payment receipt",
      `
      SELECT
        cp.id,
        cp.uuid,
        cp.booking_id,
        cp.down_payment,
        cp.status
      FROM customer_plans cp
      INNER JOIN bookings b ON b.id = cp.booking_id
      WHERE cp.down_payment > 0
        AND cp.status IN ('active', 'completed')
        AND b.status NOT IN ('cancelled', 'refunded')
        AND NOT EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.booking_id = cp.booking_id
            AND p.payment_purpose = 'down_payment'
        )
      ORDER BY cp.id ASC
      `,
    ),
  );

  checks.push(
    await runCheck(
      "Active plans with missing installment numbers",
      `
      SELECT
        cp.id,
        cp.uuid,
        cp.booking_id,
        cp.installment_count,
        ARRAY_AGG(gs.number ORDER BY gs.number)
          FILTER (WHERE i.id IS NULL) AS missing_numbers
      FROM customer_plans cp
      CROSS JOIN LATERAL generate_series(1, cp.installment_count) AS gs(number)
      LEFT JOIN installments i
        ON i.customer_plan_id = cp.id
       AND i.installment_number = gs.number
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.uuid, cp.booking_id, cp.installment_count
      HAVING COUNT(*) FILTER (WHERE i.id IS NULL) > 0
      ORDER BY cp.id ASC
      `,
    ),
  );

  checks.push(
    await runCheck(
      "Active plans where remaining balance differs from scheduled unpaid amount",
      `
      SELECT
        cp.id,
        cp.uuid,
        cp.booking_id,
        cp.remaining_balance,
        COALESCE(
          SUM(i.amount_due - i.amount_paid) FILTER (
            WHERE i.status NOT IN ('waived', 'cancelled')
          ),
          0
        ) AS scheduled_unpaid,
        cp.remaining_balance - COALESCE(
          SUM(i.amount_due - i.amount_paid) FILTER (
            WHERE i.status NOT IN ('waived', 'cancelled')
          ),
          0
        ) AS discrepancy
      FROM customer_plans cp
      LEFT JOIN installments i ON i.customer_plan_id = cp.id
      WHERE cp.status = 'active'
      GROUP BY cp.id, cp.uuid, cp.booking_id, cp.remaining_balance
      HAVING cp.remaining_balance <> COALESCE(
        SUM(i.amount_due - i.amount_paid) FILTER (
          WHERE i.status NOT IN ('waived', 'cancelled')
        ),
        0
      )
      ORDER BY cp.id ASC
      `,
    ),
  );

  checks.push(
    await runCheck(
      "Legacy receipts that assumed Cash in Hand",
      `
      SELECT
        p.id,
        p.uuid,
        p.payment_number,
        p.booking_id,
        p.payment_purpose,
        p.amount,
        p.payment_date
      FROM payments p
      WHERE p.notes LIKE 'Auto-generated legacy%'
        AND p.payment_method = 'cash'
      ORDER BY p.id ASC
      `,
    ),
  );

  checks.push(
    await runCheck(
      "Installment payments with a NULL customer",
      `
      SELECT
        p.id,
        p.uuid,
        p.payment_number,
        p.installment_id
      FROM payments p
      WHERE p.installment_id IS NOT NULL
        AND p.customer_id IS NULL
      ORDER BY p.id ASC
      `,
    ),
  );

  const totalFindings = checks.reduce((sum, check) => sum + check.count, 0);

  console.log("# Finance backfill audit");
  console.log("");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || "unknown"}`);
  console.log("Mode: read-only");
  console.log("");
  console.log(`Findings: ${totalFindings}`);
  console.log("");

  for (const check of checks) {
    console.log(`## ${check.name}`);
    console.log(`Rows: ${check.count}`);

    if (check.count > 0) {
      console.log(JSON.stringify(check.rows, null, 2));
    }

    console.log("");
  }

  if (totalFindings > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
