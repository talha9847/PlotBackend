"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const installmentService = require("../services/installmentService");
const installmentController = require("../controllers/installmentController");
const { query, pool } = require("../config/db");

const fixture = {
  projectId: null,
  projectName: null,
  plotId: null,
  secondPlotId: null,
  leadId: null,
  customerId: null,
  bookingId: null,
  bookingNumber: null,
  planId: null,
  secondBookingId: null,
  secondPlanId: null,
};

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Installment list tests write to the database and must not run in production",
    );
  }

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  fixture.bookingNumber = `OPEN-BOOKING-${suffix}`;
  fixture.projectName = `Installment Scope Project ${suffix}`;

  const projectResult = await query(
    `INSERT INTO projects (name, city, plots, status)
     VALUES ($1, 'Installment Scope City', 2, 'planning')
     RETURNING id`,
    [fixture.projectName],
  );
  fixture.projectId = projectResult.rows[0].id;

  const plotResult = await query(
    `INSERT INTO plots (project_id, plot_number, status, base_price, length, breadth)
     VALUES ($1, $2, 'booked', 100000, 30, 40)
     RETURNING id`,
    [fixture.projectId, `OPEN-${suffix}`],
  );
  fixture.plotId = plotResult.rows[0].id;

  const secondPlotResult = await query(
    `INSERT INTO plots (project_id, plot_number, status, base_price, length, breadth)
     VALUES ($1, $2, 'booked', 20000, 30, 40)
     RETURNING id`,
    [fixture.projectId, `OPEN-B-${suffix}`],
  );
  fixture.secondPlotId = secondPlotResult.rows[0].id;

  const leadResult = await query(
    `INSERT INTO leads (name, phone, project_id, plot_id)
     VALUES ('Open Installments Lead', $1, $2, $3)
     RETURNING id`,
    [
      `6${Math.floor(100000000 + Math.random() * 899999999)}`,
      fixture.projectId,
      fixture.plotId,
    ],
  );
  fixture.leadId = leadResult.rows[0].id;

  const customerResult = await query(
    `INSERT INTO customers (lead_id)
     VALUES ($1)
     RETURNING id`,
    [fixture.leadId],
  );
  fixture.customerId = customerResult.rows[0].id;

  const bookingResult = await query(
    `INSERT INTO bookings (
       booking_number, project_id, plot_id, lead_id, customer_id,
       booking_date, agreed_price, discount_amount, tax_amount,
       total_amount, booking_amount, status
     )
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 100000, 0, 0, 100000, 0, 'confirmed')
     RETURNING id`,
    [
      fixture.bookingNumber,
      fixture.projectId,
      fixture.plotId,
      fixture.leadId,
      fixture.customerId,
    ],
  );
  fixture.bookingId = bookingResult.rows[0].id;

  const planResult = await query(
    `INSERT INTO customer_plans (
       customer_id, booking_id, down_payment, installment_count,
       frequency, start_date, remaining_balance
     )
     VALUES ($1, $2, 0, 10, 'monthly', CURRENT_DATE - INTERVAL '1 month', 100000)
     RETURNING id`,
    [fixture.customerId, fixture.bookingId],
  );
  fixture.planId = planResult.rows[0].id;

  await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description, due_date,
       amount_due, amount_paid, late_fee, status, paid_at
     )
     VALUES
       ($1, 1, 'Past due pending', CURRENT_DATE - INTERVAL '30 days', 10000, 0, 0, 'pending', NULL),
       ($1, 2, 'Future pending', CURRENT_DATE + INTERVAL '30 days', 10000, 0, 0, 'pending', NULL),
       ($1, 3, 'Past due partially paid', CURRENT_DATE - INTERVAL '20 days', 10000, 3000, 0, 'partially_paid', NULL),
       ($1, 4, 'Future partially paid', CURRENT_DATE + INTERVAL '20 days', 10000, 2000, 0, 'partially_paid', NULL),
       ($1, 5, 'Paid', CURRENT_DATE - INTERVAL '10 days', 10000, 10000, 0, 'paid', NOW()),
       ($1, 6, 'Waived', CURRENT_DATE + INTERVAL '10 days', 10000, 0, 0, 'waived', NULL),
       ($1, 7, 'Cancelled', CURRENT_DATE - INTERVAL '5 days', 10000, 0, 0, 'cancelled', NULL),
       ($1, 8, 'Zero balance', CURRENT_DATE + INTERVAL '5 days', 10000, 10000, 0, 'pending', NULL),
       ($1, 9, 'Past due with late fee', CURRENT_DATE - INTERVAL '2 days', 10000, 0, 500, 'pending', NULL),
       ($1, 10, 'Due today', CURRENT_DATE, 10000, 0, 0, 'pending', NULL)`,
    [fixture.planId],
  );

  // A second plan proves the upcoming filter returns one row per plan.
  const secondBookingResult = await query(
    `INSERT INTO bookings (
       booking_number, project_id, plot_id, lead_id, customer_id,
       booking_date, agreed_price, discount_amount, tax_amount,
       total_amount, booking_amount, status
     )
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 20000, 0, 0, 20000, 0, 'confirmed')
     RETURNING id`,
    [
      `OPEN-BOOKING-B-${suffix}`,
      fixture.projectId,
      fixture.secondPlotId,
      fixture.leadId,
      fixture.customerId,
    ],
  );
  fixture.secondBookingId = secondBookingResult.rows[0].id;

  const secondPlanResult = await query(
    `INSERT INTO customer_plans (
       customer_id, booking_id, down_payment, installment_count,
       frequency, start_date, remaining_balance
     )
     VALUES ($1, $2, 0, 2, 'monthly', CURRENT_DATE - INTERVAL '1 month', 20000)
     RETURNING id`,
    [fixture.customerId, fixture.secondBookingId],
  );
  fixture.secondPlanId = secondPlanResult.rows[0].id;

  await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description, due_date,
       amount_due, amount_paid, late_fee, status, paid_at
     )
     VALUES
       ($1, 1, 'Second plan past due', CURRENT_DATE - INTERVAL '7 days', 10000, 0, 0, 'pending', NULL),
       ($1, 2, 'Second plan upcoming', CURRENT_DATE + INTERVAL '45 days', 10000, 0, 0, 'pending', NULL)`,
    [fixture.secondPlanId],
  );
});

after(async () => {
  if (fixture.planId) {
    await query("DELETE FROM installments WHERE customer_plan_id = $1", [
      fixture.planId,
    ]);
    await query("DELETE FROM customer_plans WHERE id = $1", [fixture.planId]);
  }

  if (fixture.secondPlanId) {
    await query("DELETE FROM installments WHERE customer_plan_id = $1", [
      fixture.secondPlanId,
    ]);
    await query("DELETE FROM customer_plans WHERE id = $1", [
      fixture.secondPlanId,
    ]);
  }

  if (fixture.bookingId) {
    await query("DELETE FROM bookings WHERE id = $1", [fixture.bookingId]);
  }

  if (fixture.secondBookingId) {
    await query("DELETE FROM bookings WHERE id = $1", [
      fixture.secondBookingId,
    ]);
  }

  if (fixture.customerId) {
    await query("DELETE FROM customers WHERE id = $1", [fixture.customerId]);
  }

  if (fixture.leadId) {
    await query("DELETE FROM leads WHERE id = $1", [fixture.leadId]);
  }

  if (fixture.plotId) {
    await query("DELETE FROM plots WHERE id = $1", [fixture.plotId]);
  }

  if (fixture.secondPlotId) {
    await query("DELETE FROM plots WHERE id = $1", [fixture.secondPlotId]);
  }

  if (fixture.projectId) {
    await query("DELETE FROM projects WHERE id = $1", [fixture.projectId]);
  }

  await pool.end();
});

async function fetchScope(overrides = {}) {
  return installmentService.getInstallments({
    search: fixture.bookingNumber,
    limit: 100,
    ...overrides,
  });
}

test("installments list only contains upcoming and overdue open rows", async () => {
  const result = await fetchScope();

  assert.deepEqual(
    result.installments.map((row) => row.installment_number),
    [1, 3, 9, 10, 4, 2],
  );
  assert.deepEqual(
    result.installments.map((row) => row.status),
    ["overdue", "overdue", "overdue", "pending", "partially_paid", "pending"],
  );
  assert.ok(
    result.installments.every((row) => Number(row.remaining) > 0),
    "every listed installment must have an outstanding balance",
  );

  // Count, rows, and stats all use the same open-row scope.
  assert.equal(result.pagination.total, 6);
  assert.equal(result.stats.total_installments, 6);

  assert.equal(Number(result.stats.paid_amount), 5000);
  assert.equal(Number(result.stats.outstanding_amount), 55500);
  assert.equal(result.stats.overdue_count, 3);

  // There is one plan in this search, so exactly one next upcoming row.
  assert.equal(result.stats.upcoming_count, 1);

  const overdueRow = result.installments.find(
    (row) => row.installment_number === 9,
  );
  assert.equal(Number(overdueRow.remaining), 10500);
});

test("upcoming filter returns only the next upcoming installment per plan", async () => {
  const upcoming = await fetchScope({ status: "upcoming" });

  assert.deepEqual(
    upcoming.installments.map((row) => row.installment_number),
    [10],
  );
  assert.equal(upcoming.pagination.total, 1);
  assert.equal(upcoming.pagination.totalPages, 1);
  assert.equal(upcoming.installments[0].status, "pending");

  // Overview stats stay scoped to all open rows for the search.
  assert.equal(upcoming.stats.total_installments, 6);
  assert.equal(upcoming.stats.upcoming_count, 1);
  assert.equal(upcoming.stats.overdue_count, 3);
});

test("upcoming filter returns one next installment for each plan", async () => {
  const upcoming = await installmentService.getInstallments({
    search: fixture.projectName,
    status: "upcoming",
    limit: 100,
  });

  assert.equal(upcoming.installments.length, 2);
  assert.equal(upcoming.pagination.total, 2);
  assert.deepEqual(
    upcoming.installments.map((row) => [
      row.customer_plan_id,
      row.installment_number,
    ]),
    [
      [fixture.planId, 10],
      [fixture.secondPlanId, 2],
    ],
  );
  assert.equal(
    new Set(upcoming.installments.map((row) => row.customer_plan_id)).size,
    2,
  );

  assert.equal(upcoming.stats.total_installments, 8);
  assert.equal(upcoming.stats.upcoming_count, 2);
  assert.equal(upcoming.stats.overdue_count, 4);
});

test("status filters only expose open installment statuses", async () => {
  const overdue = await fetchScope({ status: "overdue" });
  assert.deepEqual(
    overdue.installments.map((row) => row.installment_number),
    [1, 3, 9],
  );

  const pending = await fetchScope({ status: "pending" });
  assert.deepEqual(
    pending.installments.map((row) => row.installment_number),
    [10, 2],
  );

  const partiallyPaid = await fetchScope({ status: "partially_paid" });
  assert.deepEqual(
    partiallyPaid.installments.map((row) => row.installment_number),
    [4],
  );

  const paid = await fetchScope({ status: "paid" });
  assert.equal(paid.installments.length, 0);
  assert.equal(paid.pagination.total, 0);
  assert.equal(paid.stats.total_installments, 6);
});

test("controller rejects filters for paid, waived, and cancelled rows", async () => {
  for (const status of ["paid", "waived", "cancelled"]) {
    let statusCode = null;
    let body = null;

    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };

    await installmentController.getInstallments({ query: { status } }, response);

    assert.equal(statusCode, 400);
    assert.equal(body.success, false);
    assert.match(
      body.message,
      /upcoming, pending, partially paid, or overdue/,
    );
  }
});

test("controller accepts the upcoming filter", async () => {
  let statusCode = null;
  let body = null;

  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  await installmentController.getInstallments(
    { query: { status: "upcoming", search: fixture.bookingNumber } },
    response,
  );

  assert.equal(statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.pagination.total, 1);
  assert.deepEqual(
    body.data.installments.map((row) => row.installment_number),
    [10],
  );
});

test("installments on cancelled plans are excluded", async () => {
  await query("UPDATE customer_plans SET status = 'cancelled' WHERE id = $1", [
    fixture.planId,
  ]);

  try {
    const result = await fetchScope();

    assert.equal(result.installments.length, 0);
    assert.equal(result.pagination.total, 0);
    assert.equal(result.stats.total_installments, 0);
    assert.equal(result.stats.overdue_count, 0);
    assert.equal(result.stats.upcoming_count, 0);
  } finally {
    await query("UPDATE customer_plans SET status = 'active' WHERE id = $1", [
      fixture.planId,
    ]);
  }
});
