"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { query, pool } = require("../config/db");

const outArgIndex = process.argv.indexOf("--out");
const outputPath =
  outArgIndex !== -1 ? path.resolve(process.cwd(), process.argv[outArgIndex + 1]) : null;

function mdValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value).replace(/\|/g, "\\|");
}

function renderTable(columns, rows) {
  if (!rows.length) {
    return "_No rows._";
  }

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${columns.map((column) => mdValue(row[column])).join(" | ")} |`,
  );

  return [header, divider, ...body].join("\n");
}

function section(title, body) {
  return `## ${title}\n\n${body}\n`;
}

async function main() {
  const report = [];

  report.push("# Phase 0 — Finance Baseline Audit");
  report.push("");
  report.push(`**Generated:** ${new Date().toISOString()}`);
  report.push(`**Environment:** ${process.env.NODE_ENV || "unknown"}`);
  report.push("**Mode:** read-only (no writes, no schema changes)");
  report.push("");
  report.push("---");
  report.push("");

  const dbInfo = await query(`
    SELECT
      current_database() AS database,
      current_user AS db_user,
      version() AS version
  `);

  const db = dbInfo.rows[0];

  report.push(
    section(
      "Environment",
      renderTable(["database", "db_user", "version"], dbInfo.rows),
    ),
  );

  const tables = await query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  report.push(
    section(
      "Public tables",
      `${tables.rowCount} tables.\n\n${renderTable(["tablename"], tables.rows)}`,
    ),
  );

  const migrations = await query(`
    SELECT filename, executed_at
    FROM schema_migrations
    ORDER BY filename
  `);

  report.push(
    section(
      "Applied migrations",
      renderTable(["filename", "executed_at"], migrations.rows),
    ),
  );

  const accounts = await query(`
    SELECT
      id,
      account_name,
      bank_name,
      current_balance,
      is_active,
      created_at
    FROM accounts
    ORDER BY id
  `);

  report.push(
    section(
      "Accounts",
      renderTable(
        ["id", "account_name", "bank_name", "current_balance", "is_active", "created_at"],
        accounts.rows,
      ),
    ),
  );

  const accountsWithBalance = await query(`
    SELECT COUNT(*)::int AS accounts_with_balance
    FROM accounts
    WHERE current_balance <> 0
  `);

  const cashLikeAccounts = await query(`
    SELECT id, account_name, bank_name
    FROM accounts
    WHERE LOWER(account_name) LIKE '%cash%'
       OR LOWER(COALESCE(bank_name, '')) LIKE '%cash%'
    ORDER BY id
  `);

  report.push(
    section(
      "Cash-like accounts",
      renderTable(["id", "account_name", "bank_name"], cashLikeAccounts.rows),
    ),
  );

  const dataVolume = await query(`
    SELECT
      (SELECT COUNT(*) FROM bookings)::int AS bookings,
      (SELECT COUNT(*) FROM payments)::int AS payments,
      (SELECT COUNT(*) FROM customer_plans)::int AS plans,
      (SELECT COUNT(*) FROM financial_transactions)::int AS financial_transactions
  `);

  report.push(
    section(
      "Business data volume",
      renderTable(
        ["bookings", "payments", "plans", "financial_transactions"],
        dataVolume.rows,
      ),
    ),
  );

  const paymentsByStatus = await query(`
    SELECT
      status,
      COUNT(*)::int AS payments,
      COALESCE(SUM(amount), 0)::text AS total
    FROM payments
    GROUP BY status
    ORDER BY status
  `);

  report.push(
    section(
      "Payments by status",
      renderTable(["status", "payments", "total"], paymentsByStatus.rows),
    ),
  );

  const paymentsByMethod = await query(`
    SELECT
      payment_method,
      COUNT(*)::int AS payments,
      COALESCE(SUM(amount), 0)::text AS total
    FROM payments
    GROUP BY payment_method
    ORDER BY payment_method
  `);

  report.push(
    section(
      "Payments by method",
      renderTable(["payment_method", "payments", "total"], paymentsByMethod.rows),
    ),
  );

  const paymentShape = await query(`
    SELECT
      COUNT(*) FILTER (WHERE installment_id IS NULL)::int AS booking_level_payments,
      COUNT(*) FILTER (
        WHERE installment_id IS NOT NULL AND customer_id IS NULL
      )::int AS installment_payments_without_customer
    FROM payments
  `);

  report.push(
    section(
      "Payment shape and integrity",
      renderTable(
        ["booking_level_payments", "installment_payments_without_customer"],
        paymentShape.rows,
      ),
    ),
  );

  const customerMismatch = await query(`
    SELECT COUNT(*)::int AS mismatched_customer
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    WHERE p.customer_id IS DISTINCT FROM b.customer_id
  `);

  report.push(
    section(
      "Payment / booking customer consistency",
      renderTable(["mismatched_customer"], customerMismatch.rows),
    ),
  );

  const tokenReadiness = await query(`
    SELECT
      COUNT(*)::int AS bookings_with_token,
      COALESCE(SUM(b.booking_amount), 0)::text AS token_value,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.booking_id = b.id
            AND p.installment_id IS NULL
        )
      )::int AS without_receipt
    FROM bookings b
    WHERE b.booking_amount > 0
      AND b.status IN ('pending', 'reserved', 'confirmed', 'completed')
  `);

  report.push(
    section(
      "Booking tokens (backfill scope)",
      renderTable(
        ["bookings_with_token", "token_value", "without_receipt"],
        tokenReadiness.rows,
      ),
    ),
  );

  const downPaymentReadiness = await query(`
    SELECT
      COUNT(*)::int AS plans_with_down_payment,
      COALESCE(SUM(cp.down_payment), 0)::text AS down_payment_value,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.booking_id = cp.booking_id
            AND p.installment_id IS NULL
        )
      )::int AS without_receipt
    FROM customer_plans cp
    WHERE cp.down_payment > 0
  `);

  report.push(
    section(
      "Down payments (backfill scope)",
      renderTable(
        ["plans_with_down_payment", "down_payment_value", "without_receipt"],
        downPaymentReadiness.rows,
      ),
    ),
  );

  const planMismatch = await query(`
    WITH plan_totals AS (
      SELECT
        cp.id,
        cp.remaining_balance,
        COALESCE(SUM(i.amount_due - i.amount_paid), 0) AS scheduled
      FROM customer_plans cp
      LEFT JOIN installments i ON i.customer_plan_id = cp.id
      GROUP BY cp.id, cp.remaining_balance
    )
    SELECT
      COUNT(*) FILTER (
        WHERE remaining_balance <> scheduled
      )::int AS mismatched_plans,
      COALESCE(
        SUM(remaining_balance - scheduled)
          FILTER (WHERE remaining_balance <> scheduled),
        0
      )::text AS total_gap
    FROM plan_totals
  `);

  report.push(
    section(
      "Plan balance vs installment schedule",
      renderTable(["mismatched_plans", "total_gap"], planMismatch.rows),
    ),
  );

  const planMismatchSamples = await query(`
    SELECT *
    FROM (
      SELECT
        cp.id AS plan_id,
        b.booking_number,
        b.booking_amount,
        cp.down_payment,
        cp.remaining_balance,
        COALESCE(SUM(i.amount_due - i.amount_paid), 0) AS scheduled
      FROM customer_plans cp
      JOIN bookings b ON b.id = cp.booking_id
      LEFT JOIN installments i ON i.customer_plan_id = cp.id
      GROUP BY
        cp.id,
        b.booking_number,
        b.booking_amount,
        cp.down_payment,
        cp.remaining_balance
    ) t
    WHERE t.remaining_balance <> t.scheduled
    ORDER BY t.plan_id
    LIMIT 10
  `);

  report.push(
    section(
      "Plan balance mismatches (first 10)",
      renderTable(
        [
          "plan_id",
          "booking_number",
          "booking_amount",
          "down_payment",
          "remaining_balance",
          "scheduled",
        ],
        planMismatchSamples.rows,
      ),
    ),
  );

  const transactionRows = await query(`
    SELECT
      transaction_type,
      status,
      COUNT(*)::int AS entries,
      COALESCE(SUM(amount), 0)::text AS total
    FROM financial_transactions
    GROUP BY transaction_type, status
    ORDER BY transaction_type, status
  `);

  report.push(
    section(
      "Financial transactions",
      renderTable(
        ["transaction_type", "status", "entries", "total"],
        transactionRows.rows,
      ),
    ),
  );

  const rescheduleTable = await query(`
    SELECT to_regclass('public.installment_reschedules')::text AS table_name
  `);

  const rescheduleExists = Boolean(rescheduleTable.rows[0]?.table_name);
  let rescheduleRows = 0;

  if (rescheduleExists) {
    const countResult = await query(
      "SELECT COUNT(*)::int AS rows FROM installment_reschedules",
    );
    rescheduleRows = countResult.rows[0].rows;
  }

  const migrationFiles = fs.readdirSync(path.join(__dirname, "..", "migrations"));
  const hasRescheduleMigration = migrationFiles.some((file) =>
    file.toLowerCase().includes("installment_reschedules"),
  );

  const dumpPath = path.join(__dirname, "..", "actual_DB.sql");
  const dumpSql = fs.existsSync(dumpPath)
    ? fs.readFileSync(dumpPath, "utf8")
    : "";
  const dumpHasReschedule =
    /CREATE TABLE(?: IF NOT EXISTS)? installment_reschedules/i.test(dumpSql);

  report.push(
    section(
      "Schema drift",
      renderTable(
        ["table", "live_db", "actual_db_sql", "migration", "rows"],
        [
          {
            table: "installment_reschedules",
            live_db: rescheduleExists,
            actual_db_sql: dumpHasReschedule,
            migration: hasRescheduleMigration,
            rows: rescheduleRows,
          },
        ],
      ),
    ),
  );

  const bookingStatuses = await query(`
    SELECT status, COUNT(*)::int AS bookings
    FROM bookings
    GROUP BY status
    ORDER BY status
  `);

  report.push(
    section(
      "Bookings by status",
      renderTable(["status", "bookings"], bookingStatuses.rows),
    ),
  );

  const findings = [];

  if (paymentShape.rows[0].booking_level_payments === 0) {
    findings.push(
      "No booking-level payments exist yet: tokens and down payments are invisible to the current payments-only history.",
    );
  }

  if (tokenReadiness.rows[0].without_receipt > 0) {
    findings.push(
      `${tokenReadiness.rows[0].without_receipt} bookings carry a token (${tokenReadiness.rows[0].token_value}) with no matching payment row.`,
    );
  }

  if (downPaymentReadiness.rows[0].without_receipt > 0) {
    findings.push(
      `${downPaymentReadiness.rows[0].without_receipt} plans carry a down payment (${downPaymentReadiness.rows[0].down_payment_value}) with no matching payment row.`,
    );
  }

  if (planMismatch.rows[0].mismatched_plans > 0) {
    findings.push(
      `${planMismatch.rows[0].mismatched_plans} plans disagree with their installment schedule; total gap ${planMismatch.rows[0].total_gap}. This is the booking_amount trigger defect.`,
    );
  }

  if (accountsWithBalance.rows[0].accounts_with_balance > 0) {
    findings.push(
      `${accountsWithBalance.rows[0].accounts_with_balance} accounts have a non-zero current_balance even though no service writes it.`,
    );
  }

  if (paymentShape.rows[0].installment_payments_without_customer > 0) {
    findings.push(
      `${paymentShape.rows[0].installment_payments_without_customer} installment payments have no customer.`,
    );
  }

  if (customerMismatch.rows[0].mismatched_customer > 0) {
    findings.push(
      `${customerMismatch.rows[0].mismatched_customer} payments reference a customer different from their booking's customer.`,
    );
  }

  if (cashLikeAccounts.rows.length > 0) {
    const names = cashLikeAccounts.rows
      .map((account) => `#${account.id} "${account.account_name}"`)
      .join(", ");

    findings.push(
      `Existing cash-like account(s) found: ${names}. Phase 1 must classify these as account_type='cash' instead of seeding a second cash account.`,
    );
  }

  const volume = dataVolume.rows[0];

  if (
    volume.bookings === 0 &&
    volume.payments === 0 &&
    volume.plans === 0 &&
    volume.financial_transactions === 0
  ) {
    findings.push(
      "This database contains no business data. Backfill is a no-op locally; run this audit against the deployment database before Phase 2.",
    );
  }

  if (rescheduleExists && !hasRescheduleMigration) {
    findings.push(
      `installment_reschedules exists in the database with ${rescheduleRows} rows but no migration creates it.`,
    );
  }

  if (rescheduleExists !== dumpHasReschedule) {
    findings.push(
      `installment_reschedules disagrees between environments (live DB: ${rescheduleExists}, actual_DB.sql: ${dumpHasReschedule}, migration: ${hasRescheduleMigration}). Do not create it solely for parity; confirm against production first.`,
    );
  }

  if (findings.length === 0) {
    findings.push("No anomalies detected.");
  }

  report.push(
    section(
      "Findings",
      findings.map((finding) => `- ${finding}`).join("\n"),
    ),
  );

  report.push("---");
  report.push("");
  report.push(`Audit database: ${db.database}`);
  report.push("");

  const content = `${report.join("\n")}\n`;

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, "utf8");
    console.log(`Wrote ${outputPath}`);
  }

  console.log(content);
}

main()
  .catch((error) => {
    console.error("Phase 0 audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
