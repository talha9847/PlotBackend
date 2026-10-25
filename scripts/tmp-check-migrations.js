"use strict";

const { query, pool } = require("../config/db");

async function main() {
  const deleted = await query(
    `DELETE FROM schema_migrations
     WHERE filename IN (
       '018_fix_customer_plan_balance_trigger.js',
       '019_add_payment_purpose_and_nullable_customer.js',
       '020_backfill_booking_receipts.js',
       '021_create_unified_transactions_view.js'
     )
     RETURNING filename`,
  );
  console.log("Deleted migration rows:", deleted.rows);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
