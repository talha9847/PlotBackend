"use strict";

require("dotenv").config();

const { pool } = require("../config/db");
const { reconcileFinance } = require("../services/reconciliationService");

async function main() {
  const report = await reconcileFinance();

  console.log("# Finance reconciliation");
  console.log("");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Environment: ${process.env.NODE_ENV || "unknown"}`);
  console.log("Mode: read-only");
  console.log("");

  console.log("## Account balances");
  console.log("");

  for (const account of report.accounts) {
    console.log(
      [
        `${account.account_name} (${account.account_type})`,
        `opening=${account.opening_balance.toFixed(2)}`,
        `ledger=${account.ledger_balance.toFixed(2)}`,
        `computed=${account.computed_balance.toFixed(2)}`,
        `discrepancy=${account.discrepancy.toFixed(2)}`,
      ].join(" | "),
    );
  }

  console.log("");

  const sections = [
    ["Account balance mismatches", report.accountMismatches],
    ["Customer plan balance mismatches", report.planMismatches],
    ["Refund lifecycle mismatches", report.refundMismatches],
  ];

  for (const [name, rows] of sections) {
    console.log(`## ${name}`);
    console.log(`Rows: ${rows.length}`);

    if (rows.length > 0) {
      console.log(JSON.stringify(rows, null, 2));
    }

    console.log("");
  }

  console.log(`Findings: ${report.totalFindings}`);

  if (report.totalFindings > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
