"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const customerService = require("../services/customerService");
const { query, pool } = require("../config/db");

const fixture = {
  projectId: null,
  plotId: null,
  leadId: null,
  customerId: null,
  customerUuid: null,
  bookingId: null,
  planId: null,
};

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Due-installment tests write to the database and must not run in production",
    );
  }

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const projectResult = await query(
    `INSERT INTO projects (name, city, plots, status)
     VALUES ($1, 'Due Test City', 1, 'planning')
     RETURNING id`,
    [`Due Installments Project ${suffix}`],
  );
  fixture.projectId = projectResult.rows[0].id;

  const plotResult = await query(
    `INSERT INTO plots (project_id, plot_number, status, base_price, length, breadth)
     VALUES ($1, $2, 'booked', 60000, 30, 40)
     RETURNING id`,
    [fixture.projectId, `DUE-${suffix}`],
  );
  fixture.plotId = plotResult.rows[0].id;

  const leadResult = await query(
    `INSERT INTO leads (name, phone, project_id, plot_id)
     VALUES ('Due Installments Lead', $1, $2, $3)
     RETURNING id`,
    [
      `7${Math.floor(100000000 + Math.random() * 899999999)}`,
      fixture.projectId,
      fixture.plotId,
    ],
  );
  fixture.leadId = leadResult.rows[0].id;

  const customerResult = await query(
    `INSERT INTO customers (lead_id)
     VALUES ($1)
     RETURNING id, uuid`,
    [fixture.leadId],
  );
  fixture.customerId = customerResult.rows[0].id;
  fixture.customerUuid = customerResult.rows[0].uuid;

  const bookingResult = await query(
    `INSERT INTO bookings (
       booking_number, project_id, plot_id, lead_id, customer_id,
       booking_date, agreed_price, discount_amount, tax_amount,
       total_amount, booking_amount, status
     )
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 60000, 0, 0, 60000, 0, 'confirmed')
     RETURNING id`,
    [
      `DUE-BOOKING-${suffix}`,
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
     VALUES ($1, $2, 0, 7, 'monthly', CURRENT_DATE - INTERVAL '4 months', 60000)
     RETURNING id`,
    [fixture.customerId, fixture.bookingId],
  );
  fixture.planId = planResult.rows[0].id;

  await query(
    `INSERT INTO installments (
       customer_plan_id, installment_number, description, due_date,
       amount_due, amount_paid, status, paid_at
     )
     VALUES
       ($1, 1, 'Missed three months ago', CURRENT_DATE - INTERVAL '3 months', 10000, 0, 'pending', NULL),
       ($1, 2, 'Missed two months ago', CURRENT_DATE - INTERVAL '2 months', 10000, 0, 'overdue', NULL),
       ($1, 3, 'Partially paid last month', CURRENT_DATE - INTERVAL '1 month', 10000, 3000, 'partially_paid', NULL),
       ($1, 4, 'Due today', CURRENT_DATE, 10000, 0, 'pending', NULL),
       ($1, 5, 'Next future installment', CURRENT_DATE + INTERVAL '1 month', 10000, 0, 'pending', NULL),
       ($1, 6, 'Later future installment', CURRENT_DATE + INTERVAL '2 months', 10000, 0, 'pending', NULL),
       ($1, 7, 'Paid in the past', CURRENT_DATE - INTERVAL '4 months', 10000, 10000, 'paid', NOW())
     RETURNING id`,
    [fixture.planId],
  );
});

after(async () => {
  if (fixture.planId) {
    await query("DELETE FROM installments WHERE customer_plan_id = $1", [
      fixture.planId,
    ]);
    await query("DELETE FROM customer_plans WHERE id = $1", [fixture.planId]);
  }

  if (fixture.bookingId) {
    await query("DELETE FROM bookings WHERE id = $1", [fixture.bookingId]);
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

  if (fixture.projectId) {
    await query("DELETE FROM projects WHERE id = $1", [fixture.projectId]);
  }

  await pool.end();
});

test("customer profile returns only due and overdue unpaid installments with aggregate stats", async () => {
  const profile = await customerService.getCustomerProfile(
    fixture.customerUuid,
  );

  assert.ok(profile, "expected a customer profile");

  // The full schedule is still returned for the installments tab.
  assert.equal(profile.installments.length, 7);

  const dueNumbers = profile.due_installments.map(
    (row) => row.installment_number,
  );

  // Paid and future installments are excluded; every past-due and due-today
  // installment is included, even across multiple months.
  assert.deepEqual(dueNumbers, [1, 2, 3, 4]);
  assert.ok(
    profile.due_installments.every((row) => row.is_due === true),
    "every due installment should be flagged as due by the database",
  );
  assert.ok(
    profile.due_installments.every(
      (row) =>
        Number(row.amount_due) + Number(row.late_fee) >
        Number(row.amount_paid),
    ),
    "due installments must have an outstanding balance",
  );

  assert.equal(
    profile.next_upcoming_installment.installment_number,
    5,
    "the next future unpaid installment should be returned",
  );
  assert.equal(profile.next_upcoming_installment.is_due, false);

  assert.deepEqual(profile.installment_stats, {
    total_installment_value: 70000,
    total_paid_amount: 13000,
    total_pending_overdue_amount: 37000,
    overdue_count: 4,
    due_count: 4,
    total_installments: 7,
  });

  assert.equal(profile.stats.total_installments, 7);
  assert.equal(profile.stats.paid_installments, 1);
  assert.equal(profile.stats.due_installments, 4);
  assert.equal(profile.stats.pending_overdue_amount, 37000);
  assert.equal(profile.stats.total_installment_value, 70000);
  assert.equal(profile.stats.installment_paid_amount, 13000);

  // Per-booking stats mirror the customer-level view.
  assert.equal(profile.bookings.length, 1);

  const booking = profile.bookings[0];

  assert.deepEqual(
    booking.due_installments.map((row) => row.installment_number),
    [1, 2, 3, 4],
  );
  assert.equal(booking.next_upcoming_installment.installment_number, 5);
  assert.deepEqual(booking.installment_stats, {
    total_installment_value: 70000,
    total_paid_amount: 13000,
    total_pending_overdue_amount: 37000,
    overdue_count: 4,
    due_count: 4,
    total_installments: 7,
  });
});

test("settling all current dues exposes only the next upcoming installment", async () => {
  await query(
    `UPDATE installments
     SET amount_paid = amount_due + late_fee,
         status = 'paid',
         paid_at = NOW()
     WHERE customer_plan_id = $1
       AND installment_number BETWEEN 1 AND 4`,
    [fixture.planId],
  );

  const profile = await customerService.getCustomerProfile(
    fixture.customerUuid,
  );

  assert.deepEqual(profile.due_installments, []);
  assert.equal(profile.next_upcoming_installment.installment_number, 5);
  assert.equal(profile.next_upcoming_installment.is_due, false);

  assert.deepEqual(profile.installment_stats, {
    total_installment_value: 70000,
    total_paid_amount: 50000,
    total_pending_overdue_amount: 0,
    overdue_count: 0,
    due_count: 0,
    total_installments: 7,
  });

  assert.equal(profile.stats.due_installments, 0);
  assert.equal(profile.stats.pending_overdue_amount, 0);

  const booking = profile.bookings[0];

  assert.deepEqual(booking.due_installments, []);
  assert.equal(booking.next_upcoming_installment.installment_number, 5);
  assert.equal(booking.installment_stats.total_pending_overdue_amount, 0);
  assert.equal(booking.installment_stats.overdue_count, 0);
});

test("advance payment advances the next upcoming installment", async () => {
  await query(
    `UPDATE installments
     SET amount_paid = 4000,
         status = 'partially_paid'
     WHERE customer_plan_id = $1
       AND installment_number = 5`,
    [fixture.planId],
  );

  let profile = await customerService.getCustomerProfile(
    fixture.customerUuid,
  );

  assert.equal(
    profile.next_upcoming_installment.installment_number,
    5,
    "a partially paid future installment remains the next installment",
  );
  assert.equal(profile.installment_stats.total_pending_overdue_amount, 0);

  await query(
    `UPDATE installments
     SET amount_paid = amount_due + late_fee,
         status = 'paid',
         paid_at = NOW()
     WHERE customer_plan_id = $1
       AND installment_number = 5`,
    [fixture.planId],
  );

  profile = await customerService.getCustomerProfile(fixture.customerUuid);

  assert.equal(profile.next_upcoming_installment.installment_number, 6);
  assert.equal(profile.installment_stats.total_paid_amount, 60000);
  assert.equal(profile.installment_stats.total_pending_overdue_amount, 0);

  await query(
    `UPDATE installments
     SET amount_paid = amount_due + late_fee,
         status = 'paid',
         paid_at = NOW()
     WHERE customer_plan_id = $1
       AND installment_number = 6`,
    [fixture.planId],
  );

  profile = await customerService.getCustomerProfile(fixture.customerUuid);

  assert.equal(profile.next_upcoming_installment, null);
  assert.equal(profile.installments.length, 7);
  assert.equal(profile.installment_stats.total_paid_amount, 70000);
  assert.equal(profile.installment_stats.total_pending_overdue_amount, 0);
  assert.equal(profile.installment_stats.overdue_count, 0);
  assert.equal(profile.stats.due_installments, 0);
});
