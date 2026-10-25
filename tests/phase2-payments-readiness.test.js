"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const jwtService = require("../services/jwtService");
const bookingService = require("../services/bookingService");
const paymentService = require("../services/paymentService");
const accountService = require("../services/accountService");
const migration018 = require("../migrations/018_fix_customer_plan_balance_trigger");
const migration020 = require("../migrations/020_backfill_booking_receipts");
const migration026 = require("../migrations/026_normalize_whole_rupee_schedules");
const { query, pool, getClient } = require("../config/db");

let server;
let baseUrl;
let authCookie;

// Tracking IDs for cleanup
const createdProjectIds = [];
const createdPlotIds = [];
const createdLeadIds = [];
const createdCustomerIds = [];
const createdBookingIds = [];
const createdPlanIds = [];
const createdPaymentIds = [];

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Phase 2 payment tests write to the database and must not run in production",
    );
  }

  const token = await jwtService.signJwt({
    id: 1,
    role: "admin",
    name: "Phase 2 Test Admin",
  });

  authCookie = `token=${token}`;

  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });

    server.on("error", reject);
  });
});

after(async () => {
  try {
    // Remove every receipt tied to tracked fixtures before deleting schedules
    for (const id of createdBookingIds) {
      await query("DELETE FROM payments WHERE booking_id = $1", [id]);
    }
    for (const id of createdPlanIds) {
      await query(
        `DELETE FROM payments
         WHERE installment_id IN (
           SELECT id FROM installments WHERE customer_plan_id = $1
         )`,
        [id],
      );
      await query("DELETE FROM installments WHERE customer_plan_id = $1", [id]);
      await query("DELETE FROM customer_plans WHERE id = $1", [id]);
    }
    for (const id of createdPaymentIds) {
      await query("DELETE FROM payments WHERE id = $1", [id]);
    }
    for (const id of createdBookingIds) {
      await query("DELETE FROM payments WHERE booking_id = $1", [id]);
      await query("DELETE FROM bookings WHERE id = $1", [id]);
    }
    for (const id of createdCustomerIds) {
      await query("DELETE FROM customers WHERE id = $1", [id]);
    }
    for (const id of createdLeadIds) {
      await query("DELETE FROM leads WHERE id = $1", [id]);
    }
    for (const id of createdPlotIds) {
      await query("DELETE FROM plots WHERE id = $1", [id]);
    }
    for (const id of createdProjectIds) {
      await query("DELETE FROM projects WHERE id = $1", [id]);
    }
  } finally {
    if (server) {
      const closed = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      // Do not wait for idle keep-alive sockets from fetch().
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await closed;
    }

    await pool.end();
  }
});

// Helper to create test fixtures
async function createFixtures({
  plotNumber = "P2-TEST-01",
  totalAmount = 50000,
  bookingAmount = 5000,
} = {}) {
  const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const projRes = await query(
    `INSERT INTO projects (name, city, total_area, plots, status)
     VALUES ($1, 'Test City', 10000, 10, 'planning')
     RETURNING id`,
    [`Phase 2 Test Project ${uniqueSuffix}`],
  );
  createdProjectIds.push(projRes.rows[0].id);

  const plotRes = await query(
    `INSERT INTO plots (project_id, plot_number, status, base_price, length, breadth)
     VALUES ($1, $2, 'available', $3, 30, 40)
     RETURNING id, uuid`,
    [projRes.rows[0].id, `${plotNumber}-${uniqueSuffix}`, totalAmount],
  );
  createdPlotIds.push(plotRes.rows[0].id);

  const phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;
  const leadRes = await query(
    `INSERT INTO leads (name, phone, project_id, plot_id)
     VALUES ('Phase 2 Test Lead', $1, $2, $3)
     RETURNING id`,
    [phone, projRes.rows[0].id, plotRes.rows[0].id],
  );
  createdLeadIds.push(leadRes.rows[0].id);

  const bookingRes = await query(
    `INSERT INTO bookings (
       booking_number, project_id, plot_id, lead_id, booking_date,
       agreed_price, total_amount, booking_amount, status
     )
     VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $5, $6, 'pending')
     RETURNING id, uuid, total_amount, booking_amount`,
    [
      `BK-P2-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      projRes.rows[0].id,
      plotRes.rows[0].id,
      leadRes.rows[0].id,
      totalAmount,
      bookingAmount,
    ],
  );
  createdBookingIds.push(bookingRes.rows[0].id);

  return {
    projectId: projRes.rows[0].id,
    plotId: plotRes.rows[0].id,
    leadId: leadRes.rows[0].id,
    booking: bookingRes.rows[0],
  };
}

async function createPlanForBooking({
  booking,
  leadId,
  downPayment,
  installmentCount,
  frequency = "monthly",
  startDate = "2026-11-01",
  status = "active",
}) {
  const customerResult = await query(
    "INSERT INTO customers (lead_id) VALUES ($1) RETURNING id",
    [leadId],
  );
  const customerId = customerResult.rows[0].id;
  createdCustomerIds.push(customerId);

  await query("UPDATE bookings SET customer_id = $1 WHERE id = $2", [
    customerId,
    booking.id,
  ]);

  const planResult = await query(
    `INSERT INTO customer_plans (
       customer_id, booking_id, down_payment, installment_count,
       frequency, start_date, status, remaining_balance
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
     RETURNING *`,
    [
      customerId,
      booking.id,
      downPayment,
      installmentCount,
      frequency,
      startDate,
      status,
    ],
  );

  createdPlanIds.push(planResult.rows[0].id);

  return { customerId, plan: planResult.rows[0] };
}

async function getCashAccount() {
  const result = await query(
    "SELECT id FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );

  return result.rows[0];
}

test("trigger calculates remaining_balance = total_amount - booking_amount - down_payment on INSERT", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "TRIGGER-TEST-01",
    totalAmount: 100000,
    bookingAmount: 10000,
  });

  const custRes = await query(
    "INSERT INTO customers (lead_id) VALUES ($1) RETURNING id",
    [leadId],
  );
  createdCustomerIds.push(custRes.rows[0].id);

  // bookings.customer_id must be set to satisfy fk_customer_plans_booking_customer
  await query("UPDATE bookings SET customer_id = $1 WHERE id = $2", [
    custRes.rows[0].id,
    booking.id,
  ]);

  // total: 100,000, booking: 10,000, down_payment: 20,000 => remaining should be 70,000
  const planRes = await query(
    `INSERT INTO customer_plans (
       customer_id, booking_id, down_payment, installment_count,
       frequency, start_date, remaining_balance
     )
     VALUES ($1, $2, 20000, 10, 'monthly', CURRENT_DATE, 999999)
     RETURNING id, remaining_balance`,
    [custRes.rows[0].id, booking.id],
  );
  createdPlanIds.push(planRes.rows[0].id);

  assert.equal(Number(planRes.rows[0].remaining_balance), 70000);
});

test("trigger rejects INSERT when booking_amount + down_payment > total_amount", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "TRIGGER-TEST-02",
    totalAmount: 50000,
    bookingAmount: 20000,
  });

  const custRes = await query(
    "INSERT INTO customers (lead_id) VALUES ($1) RETURNING id",
    [leadId],
  );
  createdCustomerIds.push(custRes.rows[0].id);

  // booking: 20,000 + down_payment: 35,000 = 55,000 > total (50,000)
  await assert.rejects(
    async () => {
      await query(
        `INSERT INTO customer_plans (
           customer_id, booking_id, down_payment, installment_count,
           frequency, start_date, remaining_balance
         )
         VALUES ($1, $2, 35000, 5, 'monthly', CURRENT_DATE, 0)`,
        [custRes.rows[0].id, booking.id],
      );
    },
    /exceeds booking total/,
  );
});

test("trigger rejects changing booking_id on plan UPDATE", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "TRIGGER-TEST-03",
    totalAmount: 40000,
    bookingAmount: 5000,
  });

  const custRes = await query(
    "INSERT INTO customers (lead_id) VALUES ($1) RETURNING id",
    [leadId],
  );
  createdCustomerIds.push(custRes.rows[0].id);

  await query("UPDATE bookings SET customer_id = $1 WHERE id = $2", [
    custRes.rows[0].id,
    booking.id,
  ]);

  const planRes = await query(
    `INSERT INTO customer_plans (
       customer_id, booking_id, down_payment, installment_count,
       frequency, start_date, remaining_balance
     )
     VALUES ($1, $2, 5000, 5, 'monthly', CURRENT_DATE, 0)
     RETURNING id`,
    [custRes.rows[0].id, booking.id],
  );
  createdPlanIds.push(planRes.rows[0].id);

  await assert.rejects(
    async () => {
      await query(
        "UPDATE customer_plans SET booking_id = 999999 WHERE id = $1",
        [planRes.rows[0].id],
      );
    },
    /Plan booking_id cannot be changed/,
  );
});

test("payments table allows NULL customer_id for booking tokens and rejects NULL customer_id for installments", async () => {
  const { booking } = await createFixtures({
    plotNumber: "PAY-TEST-01",
    totalAmount: 30000,
    bookingAmount: 3000,
  });

  const cashAccountRes = await query(
    "SELECT id FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  const cashAccountId = cashAccountRes.rows[0].id;

  // 1. Booking token with customer_id = NULL must succeed
  const tokenPayRes = await query(
    `INSERT INTO payments (
       payment_number, booking_id, customer_id, installment_id,
       account_id, payment_method, amount, payment_purpose, status
     )
     VALUES ($1, $2, NULL, NULL, $3, 'cash', 3000, 'booking_token', 'completed')
     RETURNING id, customer_id, payment_purpose`,
    [`TEST-TKN-${Date.now()}`, booking.id, cashAccountId],
  );
  createdPaymentIds.push(tokenPayRes.rows[0].id);

  assert.equal(tokenPayRes.rows[0].customer_id, null);
  assert.equal(tokenPayRes.rows[0].payment_purpose, "booking_token");

  // 2. Installment payment with customer_id = NULL must be rejected by check constraint
  await assert.rejects(
    async () => {
      await query(
        `INSERT INTO payments (
           payment_number, booking_id, customer_id, installment_id,
           account_id, payment_method, amount, payment_purpose, status
         )
         VALUES ($1, $2, NULL, 1, $3, 'cash', 1000, 'installment', 'completed')`,
        [`TEST-INST-FAIL-${Date.now()}`, booking.id, cashAccountId],
      );
    },
    /chk_payments_installment_requires_customer/,
  );
});

test("payments table rejects invalid payment_purpose values", async () => {
  const { booking } = await createFixtures({
    plotNumber: "PAY-TEST-02",
  });

  const cashAccountRes = await query(
    "SELECT id FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  const cashAccountId = cashAccountRes.rows[0].id;

  await assert.rejects(
    async () => {
      await query(
        `INSERT INTO payments (
           payment_number, booking_id, customer_id, account_id,
           payment_method, amount, payment_purpose, status
         )
         VALUES ($1, $2, NULL, $3, 'cash', 1000, 'invalid_purpose', 'completed')`,
        [`TEST-PURP-FAIL-${Date.now()}`, booking.id, cashAccountId],
      );
    },
    /chk_payments_payment_purpose/,
  );
});

test("booking confirmation generates a complete balanced whole-rupee schedule", async () => {
  // Total: 10,000, Token: 1,000, Down payment: 2,000 => Remaining: 7,000 over 3 installments.
  // The balanced whole-rupee split is 2,333, 2,333, and 2,334.
  const { booking } = await createFixtures({
    plotNumber: "CONFIRM-SCHED-01",
    totalAmount: 10000,
    bookingAmount: 1000,
  });

  const cashAccountRes = await query(
    "SELECT id FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  const cashAccountId = cashAccountRes.rows[0].id;

  // Record an initial token payment without customer_id
  const preTokenRes = await query(
    `INSERT INTO payments (
       payment_number, booking_id, customer_id, account_id,
       payment_method, amount, payment_purpose, status
     )
     VALUES ($1, $2, NULL, $3, 'cash', 1000, 'booking_token', 'completed')
     RETURNING id`,
    [`PAY-PRE-TKN-${Date.now()}`, booking.id, cashAccountId],
  );
  createdPaymentIds.push(preTokenRes.rows[0].id);

  // Confirm booking
  const confirmResult = await bookingService.confirmBooking(
    booking.uuid,
    {
      down_payment: 2000,
      installment_count: 3,
      frequency: "monthly",
      start_date: "2026-11-01",
    },
    1,
  );

  createdCustomerIds.push(confirmResult.customer_id);
  createdPlanIds.push(confirmResult.plan.id);

  // Verify plan balance
  assert.equal(Number(confirmResult.plan.remaining_balance), 7000);

  // Verify all 3 installments exist in database
  const instRes = await query(
    `SELECT installment_number, amount_due, TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date, status
     FROM installments
     WHERE customer_plan_id = $1
     ORDER BY installment_number ASC`,
    [confirmResult.plan.id],
  );

  assert.equal(instRes.rows.length, 3);
  assert.equal(Number(instRes.rows[0].amount_due), 2333);
  assert.equal(instRes.rows[0].due_date, "2026-11-01");

  assert.equal(Number(instRes.rows[1].amount_due), 2333);
  assert.equal(instRes.rows[1].due_date, "2026-12-01");

  // The extra rupee is placed on the final installment.
  assert.equal(Number(instRes.rows[2].amount_due), 2334);
  assert.equal(instRes.rows[2].due_date, "2027-01-01");

  const amounts = instRes.rows.map((row) => Number(row.amount_due));
  assert.equal(amounts.every(Number.isInteger), true);

  // Sum of installments must strictly equal the plan remaining balance
  const sumAmount = amounts.reduce((sum, amount) => sum + amount, 0);
  assert.equal(sumAmount, 7000);

  // Verify pre-existing token payment was automatically linked to the customer
  const updatedTokenRes = await query(
    "SELECT customer_id FROM payments WHERE id = $1",
    [preTokenRes.rows[0].id],
  );
  assert.equal(updatedTokenRes.rows[0].customer_id, confirmResult.customer_id);
});

test("booking confirmation keeps odd divisions whole and balanced", async () => {
  const cases = [
    {
      plotNumber: "CONFIRM-WHOLE-3",
      installmentCount: 3,
      expected: [33333, 33333, 33334],
    },
    {
      plotNumber: "CONFIRM-WHOLE-7",
      installmentCount: 7,
      expected: [14285, 14285, 14286, 14286, 14286, 14286, 14286],
    },
  ];

  for (const testCase of cases) {
    const { booking } = await createFixtures({
      plotNumber: testCase.plotNumber,
      totalAmount: 100000,
      bookingAmount: 0,
    });

    const confirmResult = await bookingService.confirmBooking(
      booking.uuid,
      {
        down_payment: 0,
        installment_count: testCase.installmentCount,
        frequency: "monthly",
        start_date: "2026-11-01",
      },
      1,
    );

    createdCustomerIds.push(confirmResult.customer_id);
    createdPlanIds.push(confirmResult.plan.id);

    const installmentResult = await query(
      `SELECT installment_number, amount_due
       FROM installments
       WHERE customer_plan_id = $1
       ORDER BY installment_number ASC`,
      [confirmResult.plan.id],
    );

    const amounts = installmentResult.rows.map((row) =>
      Number(row.amount_due),
    );

    assert.deepEqual(amounts, testCase.expected);
    assert.equal(amounts.every(Number.isInteger), true);
    assert.equal(
      amounts.reduce((sum, amount) => sum + amount, 0),
      100000,
    );
  }
});

test("booking confirmation rejects fractional or too-small plan balances with 400", async () => {
  const fractional = await createFixtures({
    plotNumber: "CONFIRM-FRACTIONAL",
    totalAmount: 10000.5,
    bookingAmount: 0,
  });

  await assert.rejects(
    () =>
      bookingService.confirmBooking(
        fractional.booking.uuid,
        {
          down_payment: 0,
          installment_count: 3,
          frequency: "monthly",
          start_date: "2026-11-01",
        },
        1,
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /whole rupee amount/);
      return true;
    },
  );

  const tooSmall = await createFixtures({
    plotNumber: "CONFIRM-TOO-SMALL",
    totalAmount: 2,
    bookingAmount: 0,
  });

  await assert.rejects(
    () =>
      bookingService.confirmBooking(
        tooSmall.booking.uuid,
        {
          down_payment: 0,
          installment_count: 3,
          frequency: "monthly",
          start_date: "2026-11-01",
        },
        1,
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /at least the number of installments/);
      return true;
    },
  );

  const unchanged = await query(
    `SELECT customer_id, status
     FROM bookings
     WHERE id = ANY($1::bigint[])`,
    [[fractional.booking.id, tooSmall.booking.id]],
  );

  assert.equal(unchanged.rows.every((row) => row.customer_id === null), true);
  assert.equal(unchanged.rows.every((row) => row.status === "pending"), true);
});

test("accountService.getTransactionsByAccount retrieves payments even when customer_id is NULL", async () => {
  const { booking } = await createFixtures({
    plotNumber: "ACCT-SERV-TEST",
    totalAmount: 25000,
    bookingAmount: 2500,
  });

  const cashAccountRes = await query(
    "SELECT id, uuid FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  const cashAccount = cashAccountRes.rows[0];

  const payNumber = `PAY-NULL-CUST-${Date.now()}`;
  const payRes = await query(
    `INSERT INTO payments (
       payment_number, booking_id, customer_id, account_id,
       payment_method, amount, payment_purpose, status
     )
     VALUES ($1, $2, NULL, $3, 'cash', 2500, 'booking_token', 'completed')
     RETURNING id`,
    [payNumber, booking.id, cashAccount.id],
  );
  createdPaymentIds.push(payRes.rows[0].id);

  const accountHistory = await accountService.getTransactionsByAccount({
    accountUuid: cashAccount.uuid,
    search: payNumber,
  });

  assert.ok(accountHistory.transactions.length >= 1);
  const found = accountHistory.transactions.find(
    (t) => t.transactionNumber === payNumber,
  );
  assert.ok(found);
  assert.equal(Number(found.amount), 2500);
  // Lead name should still be resolved via booking join
  assert.equal(found.customerName, "Phase 2 Test Lead");
});

test("plan trigger applies down-payment deltas without erasing recorded payments", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "TRIGGER-DELTA-01",
    totalAmount: 100000,
    bookingAmount: 10000,
  });

  const { customerId, plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 20000,
    installmentCount: 5,
    startDate: "2026-11-01",
  });

  assert.equal(Number(plan.remaining_balance), 70000);

  const installmentResult = await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description,
       due_date, amount_due, amount_paid, status
     )
     VALUES ($1, 1, 'Installment 1', CURRENT_DATE, 10000, 0, 'pending')
     RETURNING id, uuid`,
    [plan.id],
  );

  const cashAccount = await getCashAccount();

  await paymentService.receivePayment(
    {
      amount: 10000,
      booking_id: booking.id,
      customer_id: customerId,
      installment_id: installmentResult.rows[0].id,
      installment_uuid: installmentResult.rows[0].uuid,
      paid_at: "2026-10-24",
      payment_method: "cash",
      account_id: cashAccount.id,
      notes: "Delta trigger test",
    },
    1,
  );

  const afterPayment = await query(
    "SELECT remaining_balance FROM customer_plans WHERE id = $1",
    [plan.id],
  );
  assert.equal(Number(afterPayment.rows[0].remaining_balance), 60000);

  const afterIncrease = await query(
    `UPDATE customer_plans
     SET down_payment = 25000
     WHERE id = $1
     RETURNING remaining_balance`,
    [plan.id],
  );
  // Increase down payment by 5,000: 60,000 - 5,000 = 55,000.
  assert.equal(Number(afterIncrease.rows[0].remaining_balance), 55000);

  await assert.rejects(
    () =>
      query(
        `UPDATE customer_plans
         SET down_payment = 85000
         WHERE id = $1`,
        [plan.id],
      ),
    /exceeds the outstanding plan balance/,
  );

  const unchanged = await query(
    "SELECT remaining_balance, down_payment FROM customer_plans WHERE id = $1",
    [plan.id],
  );
  assert.equal(Number(unchanged.rows[0].remaining_balance), 55000);
  assert.equal(Number(unchanged.rows[0].down_payment), 25000);
});

test("migration 018 does not re-apply the booking-amount correction once the trigger is fixed", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "MIGRATION-018-01",
    totalAmount: 100000,
    bookingAmount: 10000,
  });

  const { plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 20000,
    installmentCount: 5,
  });

  assert.equal(Number(plan.remaining_balance), 70000);

  const client = await getClient();

  try {
    await client.query("BEGIN");
    await migration018.up(client);

    const result = await client.query(
      "SELECT remaining_balance FROM customer_plans WHERE id = $1",
      [plan.id],
    );

    // The installed trigger already uses booking_amount, so the one-time
    // correction must not subtract the 10,000 token a second time.
    assert.equal(Number(result.rows[0].remaining_balance), 70000);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("receiving a partial payment never creates a new installment row", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "NO-LAZY-INSTALLMENT",
    totalAmount: 50000,
    bookingAmount: 5000,
  });

  const { customerId, plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 5000,
    installmentCount: 4,
  });

  assert.equal(Number(plan.remaining_balance), 40000);

  const installmentResult = await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description,
       due_date, amount_due, amount_paid, status
     )
     VALUES ($1, 1, 'Installment 1', CURRENT_DATE, 40000, 0, 'pending')
     RETURNING id, uuid`,
    [plan.id],
  );

  const cashAccount = await getCashAccount();

  await paymentService.receivePayment(
    {
      amount: 10000,
      booking_id: booking.id,
      customer_id: customerId,
      installment_id: installmentResult.rows[0].id,
      installment_uuid: installmentResult.rows[0].uuid,
      paid_at: "2026-10-24",
      payment_method: "cash",
      account_id: cashAccount.id,
    },
    1,
  );

  const schedule = await query(
    `SELECT installment_number, amount_due, amount_paid, status
     FROM installments
     WHERE customer_plan_id = $1
     ORDER BY installment_number`,
    [plan.id],
  );

  assert.equal(schedule.rows.length, 1);
  assert.equal(Number(schedule.rows[0].amount_paid), 10000);
  assert.equal(schedule.rows[0].status, "partially_paid");
});

test("whole-rupee payments update a balanced schedule and plan cleanly", async () => {
  const { booking } = await createFixtures({
    plotNumber: "WHOLE-RUPEE-PAYMENTS",
    totalAmount: 7000,
    bookingAmount: 0,
  });

  const confirmResult = await bookingService.confirmBooking(
    booking.uuid,
    {
      down_payment: 0,
      installment_count: 3,
      frequency: "monthly",
      start_date: "2030-01-01",
    },
    1,
  );

  createdCustomerIds.push(confirmResult.customer_id);
  createdPlanIds.push(confirmResult.plan.id);

  const cashAccount = await getCashAccount();
  const schedule = await query(
    `SELECT id, uuid, installment_number, amount_due
     FROM installments
     WHERE customer_plan_id = $1
     ORDER BY installment_number ASC`,
    [confirmResult.plan.id],
  );

  assert.deepEqual(
    schedule.rows.map((row) => Number(row.amount_due)),
    [2333, 2333, 2334],
  );

  const payInstallment = async (installment, amount) => {
    await paymentService.receivePayment(
      {
        amount,
        booking_id: booking.id,
        customer_id: confirmResult.customer_id,
        installment_id: installment.id,
        installment_uuid: installment.uuid,
        paid_at: "2026-10-24",
        payment_method: "cash",
        account_id: cashAccount.id,
      },
      1,
    );
  };

  await payInstallment(schedule.rows[0], 1000);

  let state = await query(
    `SELECT i.amount_paid, i.status, cp.remaining_balance
     FROM installments i
     INNER JOIN customer_plans cp ON cp.id = i.customer_plan_id
     WHERE i.id = $1`,
    [schedule.rows[0].id],
  );

  assert.equal(Number(state.rows[0].amount_paid), 1000);
  assert.equal(state.rows[0].status, "partially_paid");
  assert.equal(Number(state.rows[0].remaining_balance), 6000);

  await payInstallment(schedule.rows[0], 1333);
  await payInstallment(schedule.rows[1], 2333);
  await payInstallment(schedule.rows[2], 2334);

  const finalState = await query(
    `SELECT
       cp.remaining_balance,
       cp.status AS plan_status,
       ARRAY_AGG(i.amount_paid ORDER BY i.installment_number) AS paid_amounts,
       ARRAY_AGG(i.status ORDER BY i.installment_number) AS installment_statuses
     FROM customer_plans cp
     INNER JOIN installments i ON i.customer_plan_id = cp.id
     WHERE cp.id = $1
     GROUP BY cp.id`,
    [confirmResult.plan.id],
  );

  const final = finalState.rows[0];

  assert.equal(Number(final.remaining_balance), 0);
  assert.equal(final.plan_status, "completed");
  assert.deepEqual(
    final.paid_amounts.map((amount) => Number(amount)),
    [2333, 2333, 2334],
  );
  assert.deepEqual(final.installment_statuses, ["paid", "paid", "paid"]);
  assert.equal(
    final.paid_amounts.every((amount) => Number.isInteger(Number(amount))),
    true,
  );
});

test("migration 026 normalizes fully unpaid fractional schedules", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "MIGRATION-026-UNPAID",
    totalAmount: 100000,
    bookingAmount: 0,
  });

  const { plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 0,
    installmentCount: 7,
    startDate: "2026-11-01",
  });

  assert.equal(Number(plan.remaining_balance), 100000);

  const fractionalAmounts = [
    14285.71, 14285.71, 14285.71, 14285.71, 14285.71, 14285.71, 14285.74,
  ];

  for (let index = 0; index < fractionalAmounts.length; index += 1) {
    await query(
      `INSERT INTO installments (
         customer_plan_id, installment_number, description,
         due_date, amount_due, amount_paid, status
       )
       VALUES ($1, $2, $3, '2026-11-01', $4, 0, 'pending')`,
      [
        plan.id,
        index + 1,
        `Installment ${index + 1}`,
        fractionalAmounts[index],
      ],
    );
  }

  const client = await getClient();

  try {
    await client.query("BEGIN");
    await migration026.up(client);
    await migration026.up(client);

    const schedule = await client.query(
      `SELECT amount_due
       FROM installments
       WHERE customer_plan_id = $1
       ORDER BY installment_number ASC`,
      [plan.id],
    );

    const amounts = schedule.rows.map((row) => Number(row.amount_due));

    assert.deepEqual(amounts, [
      14285, 14285, 14286, 14286, 14286, 14286, 14286,
    ]);
    assert.equal(amounts.every(Number.isInteger), true);
    assert.equal(
      amounts.reduce((sum, amount) => sum + amount, 0),
      100000,
    );

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("migration 026 skips schedules with payment history", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "MIGRATION-026-PAID",
    totalAmount: 7000,
    bookingAmount: 0,
  });

  const { plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 0,
    installmentCount: 3,
    startDate: "2026-11-01",
  });

  await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description,
       due_date, amount_due, amount_paid, status
     )
     VALUES
       ($1, 1, 'Installment 1', '2026-11-01', 2333.33, 1000, 'partially_paid'),
       ($1, 2, 'Installment 2', '2026-12-01', 2333.33, 0, 'pending'),
       ($1, 3, 'Installment 3', '2027-01-01', 2333.34, 0, 'pending')`,
    [plan.id],
  );

  const client = await getClient();

  try {
    await client.query("BEGIN");
    await migration026.up(client);

    const schedule = await client.query(
      `SELECT amount_due, amount_paid
       FROM installments
       WHERE customer_plan_id = $1
       ORDER BY installment_number ASC`,
      [plan.id],
    );

    assert.deepEqual(
      schedule.rows.map((row) => Number(row.amount_due)),
      [2333.33, 2333.33, 2333.34],
    );
    assert.equal(Number(schedule.rows[0].amount_paid), 1000);

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("migration 020 repairs a gapped, under-allocated active schedule", async () => {
  const { booking, leadId } = await createFixtures({
    plotNumber: "MIGRATION-020-GAP",
    totalAmount: 100000,
    bookingAmount: 0,
  });

  const { plan } = await createPlanForBooking({
    booking,
    leadId,
    downPayment: 40000,
    installmentCount: 3,
    startDate: "2026-11-01",
  });

  assert.equal(Number(plan.remaining_balance), 60000);

  await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description,
       due_date, amount_due, amount_paid, status, paid_at
     )
     VALUES
       ($1, 1, 'Installment 1', '2026-11-01', 10000, 10000, 'paid', NOW()),
       ($1, 3, 'Installment 3', '2027-01-01', 10000, 10000, 'paid', NOW())`,
    [plan.id],
  );

  const client = await getClient();

  try {
    await client.query("BEGIN");
    await migration020.up(client);

    const schedule = await client.query(
      `SELECT installment_number, amount_due, amount_paid, status
       FROM installments
       WHERE customer_plan_id = $1
       ORDER BY installment_number`,
      [plan.id],
    );

    assert.equal(schedule.rows.length, 3);
    assert.equal(Number(schedule.rows[1].amount_due), 60000);
    assert.equal(Number(schedule.rows[1].amount_paid), 0);

    const unpaid = schedule.rows.reduce(
      (sum, row) => sum + Number(row.amount_due) - Number(row.amount_paid),
      0,
    );
    assert.equal(Number(unpaid.toFixed(2)), 60000);

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("migration 020 skips cancelled bookings and is idempotent for active ones", async () => {
  const cancelled = await createFixtures({
    plotNumber: "MIGRATION-020-CANCELLED",
    totalAmount: 30000,
    bookingAmount: 5000,
  });

  await query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [
    cancelled.booking.id,
  ]);

  const active = await createFixtures({
    plotNumber: "MIGRATION-020-ACTIVE",
    totalAmount: 30000,
    bookingAmount: 5000,
  });

  const client = await getClient();

  try {
    await client.query("BEGIN");
    await migration020.up(client);
    await migration020.up(client);

    const cancelledReceipts = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM payments
       WHERE booking_id = $1
         AND payment_purpose = 'booking_token'`,
      [cancelled.booking.id],
    );
    const activeReceipts = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM payments
       WHERE booking_id = $1
         AND payment_purpose = 'booking_token'`,
      [active.booking.id],
    );

    assert.equal(cancelledReceipts.rows[0].count, 0);
    assert.equal(activeReceipts.rows[0].count, 1);

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("the unique receipt index rejects a second booking token", async () => {
  const { booking } = await createFixtures({
    plotNumber: "UNIQUE-TOKEN-01",
    totalAmount: 30000,
    bookingAmount: 3000,
  });

  const cashAccount = await getCashAccount();

  await query(
    `INSERT INTO payments (
       payment_number, booking_id, customer_id, installment_id,
       account_id, payment_method, amount, payment_purpose, status
     )
     VALUES ($1, $2, NULL, NULL, $3, 'cash', 3000, 'booking_token', 'completed')`,
    [`TEST-TKN-A-${Date.now()}`, booking.id, cashAccount.id],
  );

  await assert.rejects(
    () =>
      query(
        `INSERT INTO payments (
           payment_number, booking_id, customer_id, installment_id,
           account_id, payment_method, amount, payment_purpose, status
         )
         VALUES ($1, $2, NULL, NULL, $3, 'cash', 3000, 'booking_token', 'completed')`,
        [`TEST-TKN-B-${Date.now()}`, booking.id, cashAccount.id],
      ),
    /uq_payments_booking_receipt_purpose/,
  );
});

test("booking confirmation rejects milestone and custom frequencies without explicit dates", async () => {
  const { booking } = await createFixtures({
    plotNumber: "FREQUENCY-TEST-01",
    totalAmount: 30000,
    bookingAmount: 3000,
  });

  for (const frequency of ["milestone", "custom"]) {
    await assert.rejects(
      () =>
        bookingService.confirmBooking(
          booking.uuid,
          {
            down_payment: 3000,
            installment_count: 3,
            frequency,
            start_date: "2026-11-01",
          },
          1,
        ),
      /explicit due date for every installment/,
    );
  }
});
