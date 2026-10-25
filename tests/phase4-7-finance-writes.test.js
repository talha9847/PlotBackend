"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const jwtService = require("../services/jwtService");
const { query, pool } = require("../config/db");
const { reconcileFinance } = require("../services/reconciliationService");

const WRITE_DATE = "2036-03-15";
const PLAN_START = "2036-04-01";

let server;
let baseUrl;

let cashAccount;
let bankAccount;
let project;
let lead;
let category;
let party;

const plots = [];
const createdBookingIds = [];
const createdFinancialTransactionIds = [];
const createdTransferIds = [];
const createdAccountIds = [];

const ROLE_COOKIES = {};
const ALL_ROLES = ["admin", "manager", "accountant", "sales", "viewer", "broker"];

function cookieFor(role) {
  return ROLE_COOKIES[role];
}

function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

function api(role, path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookieFor(role),
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createPlot(label) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const result = await query(
    `INSERT INTO plots (
       project_id, plot_number, status, base_price, length, breadth
     )
     VALUES ($1, $2, 'available', 120000, 30, 40)
     RETURNING id, uuid`,
    [project.id, `${label}-${suffix}`],
  );

  plots.push(result.rows[0]);
  return result.rows[0];
}

async function createApiBooking(plot, tokenAmount, key) {
  const response = await api("sales", "/api/bookings/create", {
    method: "POST",
    idempotencyKey: key,
    body: {
      project_id: project.id,
      plot_id: plot.id,
      lead_id: lead.id,
      booking_date: WRITE_DATE,
      agreed_price: "100000",
      discount_amount: "0",
      tax_amount: "0",
      booking_amount: String(tokenAmount),
      payment_method: "cash",
      payment_date: WRITE_DATE,
      notes: "Phase 4-7 booking fixture",
    },
  });

  return response;
}

async function createBankAccount(openingBalance = 0) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const result = await query(
    `INSERT INTO accounts (
       account_name, bank_name, account_type, opening_balance
     )
     VALUES ($1, 'Phase 4-7 Overdraw Bank', 'bank', $2)
     RETURNING id, uuid, account_name`,
    [`Phase 4-7 Overdraw ${suffix}`, openingBalance],
  );

  createdAccountIds.push(result.rows[0].id);
  return result.rows[0];
}

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Phase 4-7 finance tests write to the database and must not run in production",
    );
  }

  for (const role of ALL_ROLES) {
    const token = await jwtService.signJwt({
      id: 1,
      role,
      name: `Phase 4-7 ${role}`,
    });
    ROLE_COOKIES[role] = `token=${token}`;
  }

  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });

    server.on("error", reject);
  });

  const cashResult = await query(
    "SELECT id, uuid, account_name FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  cashAccount = cashResult.rows[0];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const bankResult = await query(
    `INSERT INTO accounts (
       account_name, bank_name, account_type, opening_balance
     )
     VALUES ($1, 'Phase 4-7 Bank', 'bank', 0)
     RETURNING id, uuid`,
    [`Phase 4-7 Bank ${suffix}`],
  );
  bankAccount = bankResult.rows[0];

  const projectResult = await query(
    `INSERT INTO projects (name, city, total_area, plots, status)
     VALUES ($1, 'Test City', 10000, 10, 'planning')
     RETURNING id, uuid`,
    [`Phase 4-7 Project ${suffix}`],
  );
  project = projectResult.rows[0];

  const leadResult = await query(
    `INSERT INTO leads (name, phone, project_id)
     VALUES ('Phase 4-7 Lead', $1, $2)
     RETURNING id`,
    [
      `9${Math.floor(100000000 + Math.random() * 899999999)}`,
      project.id,
    ],
  );
  lead = leadResult.rows[0];

  const categoryResult = await query(
    `INSERT INTO transaction_categories (name, description, created_by)
     VALUES ($1, 'Phase 4-7 category', 1)
     RETURNING id, uuid`,
    [`Phase 4-7 Category ${suffix}`],
  );
  category = categoryResult.rows[0];

  const partyResult = await query(
    `INSERT INTO parties (name, party_type, phone, created_by)
     VALUES ('Phase 4-7 Party', 'vendor', $1, 1)
     RETURNING id, uuid`,
    [`6${Math.floor(100000000 + Math.random() * 899999999)}`],
  );
  party = partyResult.rows[0];
});

after(async () => {
  const bookingIds = createdBookingIds;

  if (bookingIds.length > 0) {
    const paymentResult = await query(
      "SELECT id FROM payments WHERE booking_id = ANY($1::bigint[])",
      [bookingIds],
    );
    const paymentIds = paymentResult.rows.map((row) => row.id);

    if (paymentIds.length > 0) {
      await query(
        "DELETE FROM payment_reversals WHERE original_payment_id = ANY($1::bigint[])",
        [paymentIds],
      );
      await query("DELETE FROM payments WHERE id = ANY($1::bigint[])", [
        paymentIds,
      ]);
    }

    await query(
      `DELETE FROM installments
       WHERE customer_plan_id IN (
         SELECT id FROM customer_plans WHERE booking_id = ANY($1::bigint[])
       )`,
      [bookingIds],
    );
    await query(
      "DELETE FROM customer_plans WHERE booking_id = ANY($1::bigint[])",
      [bookingIds],
    );
  }

  if (createdTransferIds.length > 0) {
    await query("DELETE FROM account_transfers WHERE id = ANY($1::bigint[])", [
      createdTransferIds,
    ]);
  }

  if (createdFinancialTransactionIds.length > 0) {
    await query(
      "DELETE FROM financial_transactions WHERE id = ANY($1::bigint[])",
      [createdFinancialTransactionIds],
    );
  }

  if (createdAccountIds.length > 0) {
    await query("DELETE FROM accounts WHERE id = ANY($1::bigint[])", [
      createdAccountIds,
    ]);
  }

  await query("DELETE FROM idempotency_keys WHERE key LIKE 'p47test-%'");

  for (const id of createdBookingIds) {
    await query("DELETE FROM bookings WHERE id = $1", [id]);
  }

  if (lead) {
    await query("DELETE FROM customers WHERE lead_id = $1", [lead.id]);
    await query("DELETE FROM leads WHERE id = $1", [lead.id]);
  }

  if (lead) {
    await query("DELETE FROM leads WHERE id = $1", [lead.id]);
  }

  for (const plot of plots) {
    await query("DELETE FROM plots WHERE id = $1", [plot.id]);
  }

  if (project) {
    await query("DELETE FROM projects WHERE id = $1", [project.id]);
  }

  if (category) {
    await query("DELETE FROM transaction_categories WHERE id = $1", [
      category.id,
    ]);
  }

  if (party) {
    await query("DELETE FROM parties WHERE id = $1", [party.id]);
  }

  if (bankAccount) {
    await query("DELETE FROM accounts WHERE id = $1", [bankAccount.id]);
  }

  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await pool.end();
});

// Booking lifecycle and receipts.

let booking;
let tokenPayment;
let plan;
let downPaymentReceipt;

test("booking creation records an idempotent token receipt", async () => {
  const plot = await createPlot("P47-A");
  const response = await createApiBooking(plot, 15000, "p47test-booking-1");
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.booking.status, "pending");
  assert.equal(Number(body.data.booking.booking_amount), 15000);
  assert.equal(body.data.booking.token_payment.payment_purpose, "booking_token");
  assert.equal(
    Number(body.data.booking.token_payment.account_id),
    Number(cashAccount.id),
  );
  assert.equal(body.data.booking.token_payment.payment_method, "cash");

  booking = body.data.booking;
  tokenPayment = body.data.booking.token_payment;
  createdBookingIds.push(booking.id);

  const replay = await createApiBooking(plot, 15000, "p47test-booking-1");
  const replayBody = await replay.json();

  assert.equal(replay.status, 201);
  assert.equal(replayBody.data.booking.uuid, booking.uuid);
  assert.equal(replayBody.data.booking.idempotent_replay, true);

  const receiptCount = await query(
    `SELECT COUNT(*)::int AS count
     FROM payments
     WHERE booking_id = $1
       AND payment_purpose = 'booking_token'`,
    [booking.id],
  );

  assert.equal(receiptCount.rows[0].count, 1);

  const plotAfter = await query("SELECT status FROM plots WHERE id = $1", [
    plot.id,
  ]);
  assert.equal(plotAfter.rows[0].status, "booked");
});

test("booking creation validates non-cash token accounts and plot availability", async () => {
  const plot = await createPlot("P47-VALIDATION");

  const noAccount = await api("sales", "/api/bookings/create", {
    method: "POST",
    body: {
      project_id: project.id,
      plot_id: plot.id,
      lead_id: lead.id,
      booking_date: WRITE_DATE,
      agreed_price: "100000",
      booking_amount: "5000",
      payment_method: "upi",
    },
  });

  assert.equal(noAccount.status, 400);

  const duplicatePlot = await api("sales", "/api/bookings/create", {
    method: "POST",
    body: {
      project_id: project.id,
      plot_id: booking.plot_id,
      lead_id: lead.id,
      booking_date: WRITE_DATE,
      agreed_price: "100000",
      booking_amount: "0",
    },
  });

  assert.equal(duplicatePlot.status, 409);
});

test("booking confirmation records a down-payment receipt and full schedule", async () => {
  const response = await api("manager", `/api/bookings/confirm/${booking.uuid}`, {
    method: "POST",
    body: {
      down_payment: "10000",
      installment_count: 3,
      frequency: "monthly",
      start_date: PLAN_START,
      status: "active",
      payment_method: "bank_transfer",
      account_id: bankAccount.id,
      payment_date: WRITE_DATE,
      reference_number: "CONFIRM-P47",
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));

  plan = body.data.plan;
  downPaymentReceipt = body.data.down_payment_receipt;

  assert.equal(Number(plan.remaining_balance), 75000);
  assert.equal(body.data.installments.length, 3);
  assert.deepEqual(
    body.data.installments.map((row) => Number(row.amount_due)),
    [25000, 25000, 25000],
  );

  const dueDates = await query(
    `SELECT TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
     FROM installments
     WHERE customer_plan_id = $1
     ORDER BY installment_number`,
    [plan.id],
  );

  assert.deepEqual(
    dueDates.rows.map((row) => row.due_date),
    ["2036-04-01", "2036-05-01", "2036-06-01"],
  );

  assert.ok(downPaymentReceipt);
  assert.equal(downPaymentReceipt.payment_purpose, "down_payment");
  assert.equal(Number(downPaymentReceipt.amount), 10000);
  assert.equal(Number(downPaymentReceipt.account_id), Number(bankAccount.id));

  const repeat = await api("manager", `/api/bookings/confirm/${booking.uuid}`, {
    method: "POST",
    body: {
      down_payment: "0",
      installment_count: 2,
      frequency: "monthly",
      start_date: PLAN_START,
    },
  });

  assert.equal(repeat.status, 409);

  const bookingResult = await query(
    "SELECT status, customer_id FROM bookings WHERE id = $1",
    [booking.id],
  );
  assert.equal(bookingResult.rows[0].status, "confirmed");
  assert.ok(bookingResult.rows[0].customer_id);
});

// Income, expense, and transfers.

let incomeTransaction;
let expenseTransaction;

test("income and expense writes are idempotent and appear in the unified ledger", async () => {
  const incomeResponse = await api("accountant", "/api/transactions", {
    method: "POST",
    idempotencyKey: "p47test-income-1",
    body: {
      transaction_type: "income",
      amount: "5000",
      category_id: category.id,
      party_id: party.id,
      payment_method: "cash",
      transaction_date: WRITE_DATE,
      reference_number: "INC-P47",
      notes: "Phase 4-7 income",
    },
  });
  const incomeBody = await incomeResponse.json();

  assert.equal(incomeResponse.status, 201, JSON.stringify(incomeBody));
  assert.match(
    incomeBody.data.transaction.transaction_number,
    /^TXN-2036-\d{4}$/,
  );

  incomeTransaction = incomeBody.data.transaction;
  createdFinancialTransactionIds.push(incomeTransaction.id);

  const replay = await api("accountant", "/api/transactions", {
    method: "POST",
    idempotencyKey: "p47test-income-1",
    body: {
      transaction_type: "income",
      amount: "5000",
      category_id: category.id,
      party_id: party.id,
      payment_method: "cash",
      transaction_date: WRITE_DATE,
    },
  });
  const replayBody = await replay.json();

  assert.equal(replay.status, 201);
  assert.equal(replayBody.data.transaction.uuid, incomeTransaction.uuid);
  assert.equal(replayBody.data.idempotent_replay, true);

  const countResult = await query(
    "SELECT COUNT(*)::int AS count FROM financial_transactions WHERE uuid = $1",
    [incomeTransaction.uuid],
  );
  assert.equal(countResult.rows[0].count, 1);

  const expenseResponse = await api("accountant", "/api/transactions", {
    method: "POST",
    body: {
      transaction_type: "expense",
      amount: "1200",
      category_id: category.id,
      party_id: party.id,
      account_id: bankAccount.id,
      payment_method: "bank_transfer",
      transaction_date: WRITE_DATE,
      notes: "Phase 4-7 expense",
    },
  });
  const expenseBody = await expenseResponse.json();

  assert.equal(expenseResponse.status, 201, JSON.stringify(expenseBody));
  expenseTransaction = expenseBody.data.transaction;
  createdFinancialTransactionIds.push(expenseTransaction.id);

  const missingAccount = await api("accountant", "/api/transactions", {
    method: "POST",
    body: {
      transaction_type: "expense",
      amount: "100",
      category_id: category.id,
      payment_method: "upi",
      transaction_date: WRITE_DATE,
    },
  });

  assert.equal(missingAccount.status, 400);

  const ledgerResponse = await api(
    "viewer",
    `/api/transactions?start_date=${WRITE_DATE}&end_date=${WRITE_DATE}&limit=100`,
  );
  const ledgerBody = await ledgerResponse.json();

  assert.equal(ledgerResponse.status, 200);

  const incomeRow = ledgerBody.data.transactions.find(
    (row) => row.sourceUuid === incomeTransaction.uuid,
  );
  const expenseRow = ledgerBody.data.transactions.find(
    (row) => row.sourceUuid === expenseTransaction.uuid,
  );

  assert.ok(incomeRow);
  assert.ok(expenseRow);
  assert.equal(incomeRow.direction, "credit");
  assert.equal(incomeRow.channel, "cash");
  assert.equal(expenseRow.direction, "debit");
  assert.equal(expenseRow.channel, "bank");

  const summary = ledgerBody.data.summary;
  assert.ok(Number(summary.cashInflow) >= 5000);
  assert.ok(Number(summary.bankOutflow) >= 1200);
});

test("account transfers create balanced legs excluded from cash flow", async () => {
  const response = await api("accountant", "/api/transactions/transfers", {
    method: "POST",
    body: {
      from_account_id: cashAccount.id,
      to_account_id: bankAccount.id,
      amount: "3000",
      transfer_date: WRITE_DATE,
      reference_number: "TRF-P47",
      notes: "Phase 4-7 transfer",
    },
  });
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.match(body.data.transfer.transfer_number, /^TRF-2036-\d{4}$/);

  const transfer = body.data.transfer;
  createdTransferIds.push(transfer.id);

  const legs = await query(
    `SELECT source_row_id, direction, channel, amount,
            counts_as_balance, counts_as_cash_flow, account_id
     FROM v_unified_transactions
     WHERE source_type = 'account_transfer'
       AND source_uuid = $1
     ORDER BY direction`,
    [transfer.uuid],
  );

  assert.equal(legs.rowCount, 2);
  assert.equal(Number(legs.rows[0].amount), 3000);
  assert.equal(Number(legs.rows[1].amount), 3000);
  assert.ok(legs.rows.every((row) => row.counts_as_balance === true));
  assert.ok(legs.rows.every((row) => row.counts_as_cash_flow === false));

  const debitRow = legs.rows.find((row) => row.direction === "debit");
  const creditRow = legs.rows.find((row) => row.direction === "credit");

  assert.equal(Number(debitRow.account_id), Number(cashAccount.id));
  assert.equal(Number(creditRow.account_id), Number(bankAccount.id));
  assert.equal(debitRow.source_row_id, `${transfer.uuid}-debit`);
  assert.equal(creditRow.source_row_id, `${transfer.uuid}-credit`);

  const detail = await api(
    "viewer",
    `/api/transactions/account_transfer/${transfer.uuid}?source_row_id=${transfer.uuid}-credit`,
  );
  const detailBody = await detail.json();

  assert.equal(detail.status, 200);
  assert.equal(detailBody.data.transaction.direction, "credit");
  assert.equal(
    detailBody.data.transaction.sourceRowId,
    `${transfer.uuid}-credit`,
  );

  const sameAccount = await api("accountant", "/api/transactions/transfers", {
    method: "POST",
    body: {
      from_account_id: cashAccount.id,
      to_account_id: cashAccount.id,
      amount: "100",
      transfer_date: WRITE_DATE,
    },
  });

  assert.equal(sameAccount.status, 400);
});

// Overdraw protection.

test("expenses cannot overdraw the account balance", async () => {
  const account = await createBankAccount("1000");

  const spend = await api("accountant", "/api/transactions", {
    method: "POST",
    body: {
      transaction_type: "expense",
      amount: "1000",
      category_id: category.id,
      account_id: account.id,
      payment_method: "bank_transfer",
      transaction_date: WRITE_DATE,
      notes: "Phase 4-7 exact-balance expense",
    },
  });
  const spendBody = await spend.json();

  assert.equal(spend.status, 201, JSON.stringify(spendBody));
  createdFinancialTransactionIds.push(spendBody.data.transaction.id);

  const over = await api("accountant", "/api/transactions", {
    method: "POST",
    body: {
      transaction_type: "expense",
      amount: "0.01",
      category_id: category.id,
      account_id: account.id,
      payment_method: "bank_transfer",
      transaction_date: WRITE_DATE,
      notes: "Phase 4-7 overdraw expense",
    },
  });
  const overBody = await over.json();

  assert.equal(over.status, 409, JSON.stringify(overBody));
  assert.equal(
    overBody.message,
    `Insufficient balance in ${account.account_name}`,
  );
});

test("transfers cannot overdraw the source account", async () => {
  const source = await createBankAccount("500");
  const destination = await createBankAccount(0);

  const funded = await api("accountant", "/api/transactions/transfers", {
    method: "POST",
    body: {
      from_account_id: source.id,
      to_account_id: destination.id,
      amount: "500",
      transfer_date: WRITE_DATE,
      notes: "Phase 4-7 exact-balance transfer",
    },
  });
  const fundedBody = await funded.json();

  assert.equal(funded.status, 201, JSON.stringify(fundedBody));
  createdTransferIds.push(fundedBody.data.transfer.id);

  const bankOver = await api("accountant", "/api/transactions/transfers", {
    method: "POST",
    body: {
      from_account_id: source.id,
      to_account_id: destination.id,
      amount: "0.01",
      transfer_date: WRITE_DATE,
      notes: "Phase 4-7 overdraw transfer",
    },
  });
  const bankOverBody = await bankOver.json();

  assert.equal(bankOver.status, 409, JSON.stringify(bankOverBody));
  assert.equal(
    bankOverBody.message,
    `Insufficient balance in ${source.account_name}`,
  );

  // Use an amount far above any realistic balance so the assertion stays
  // deterministic even when other test files add cash receipts in parallel.
  const cashOver = await api("accountant", "/api/transactions/transfers", {
    method: "POST",
    body: {
      from_account_id: cashAccount.id,
      to_account_id: destination.id,
      amount: "999999999999",
      transfer_date: WRITE_DATE,
      notes: "Phase 4-7 cash overdraw transfer",
    },
  });
  const cashOverBody = await cashOver.json();

  assert.equal(cashOver.status, 409, JSON.stringify(cashOverBody));
  assert.equal(
    cashOverBody.message,
    `Insufficient balance in ${cashAccount.account_name}`,
  );
});

test("refunds cannot overdraw the payout account", async () => {
  const account = await createBankAccount(0);

  const response = await api(
    "manager",
    `/api/payments/${tokenPayment.uuid}/refund`,
    {
      method: "POST",
      body: {
        amount: "1000",
        reason: "Overdraw refund attempt",
        payment_method: "bank_transfer",
        account_id: account.id,
        refund_date: WRITE_DATE,
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(
    body.message,
    `Insufficient balance in ${account.account_name}`,
  );

  const paymentResult = await query(
    "SELECT status FROM payments WHERE id = $1",
    [tokenPayment.id],
  );
  assert.equal(paymentResult.rows[0].status, "completed");

  const reversalResult = await query(
    `SELECT COUNT(*)::int AS count
     FROM payment_reversals
     WHERE original_payment_id = $1`,
    [tokenPayment.id],
  );
  assert.equal(reversalResult.rows[0].count, 0);
});

test("concurrent expenses cannot overdraw the same account", async () => {
  const account = await createBankAccount("1000");

  const makeExpense = () =>
    api("accountant", "/api/transactions", {
      method: "POST",
      body: {
        transaction_type: "expense",
        amount: "800",
        category_id: category.id,
        account_id: account.id,
        payment_method: "bank_transfer",
        transaction_date: WRITE_DATE,
        notes: "Phase 4-7 concurrent overdraw attempt",
      },
    });

  const responses = await Promise.all([makeExpense(), makeExpense()]);
  const bodies = await Promise.all(
    responses.map((response) => response.json()),
  );

  responses.forEach((response, index) => {
    if (response.status === 201) {
      createdFinancialTransactionIds.push(
        bodies[index].data.transaction.id,
      );
    }
  });

  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );

  const failedIndex = responses.findIndex(
    (response) => response.status === 409,
  );
  assert.equal(
    bodies[failedIndex].message,
    `Insufficient balance in ${account.account_name}`,
  );

  const spendResult = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
     FROM financial_transactions
     WHERE account_id = $1
       AND transaction_type = 'expense'
       AND status = 'posted'`,
    [account.id],
  );

  assert.equal(spendResult.rows[0].count, 1);
  assert.equal(Number(spendResult.rows[0].total), 800);
});

test("cash account is funded for refund coverage", async () => {
  const response = await api("accountant", "/api/transactions", {
    method: "POST",
    body: {
      transaction_type: "income",
      amount: "20000",
      category_id: category.id,
      payment_method: "cash",
      transaction_date: WRITE_DATE,
      notes: "Phase 4-7 refund funding",
    },
  });
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  createdFinancialTransactionIds.push(body.data.transaction.id);
});

// Refunds.

test("refunds track partial and full lifecycle and reject over-refunds", async () => {
  const partial = await api(
    "manager",
    `/api/payments/${tokenPayment.uuid}/refund`,
    {
      method: "POST",
      body: {
        amount: "5000",
        reason: "Partial token refund",
        payment_method: "cash",
        refund_date: WRITE_DATE,
      },
    },
  );
  const partialBody = await partial.json();

  assert.equal(partial.status, 201, JSON.stringify(partialBody));
  assert.equal(partialBody.data.payment.status, "partially_refunded");
  assert.equal(Number(partialBody.data.refunded_total), 5000);
  assert.equal(Number(partialBody.data.remaining_refundable), 10000);

  const detail = await api("viewer", `/api/transactions/payment/${tokenPayment.uuid}`);
  const detailBody = await detail.json();

  assert.equal(detail.status, 200);
  assert.equal(detailBody.data.transaction.status, "partially_refunded");

  const overRefund = await api(
    "manager",
    `/api/payments/${tokenPayment.uuid}/refund`,
    {
      method: "POST",
      body: {
        amount: "10001",
        reason: "Over refund",
        payment_method: "cash",
        refund_date: WRITE_DATE,
      },
    },
  );
  const overBody = await overRefund.json();

  assert.equal(overRefund.status, 409);
  assert.match(overBody.message, /refundable balance/i);

  const full = await api(
    "manager",
    `/api/payments/${tokenPayment.uuid}/refund`,
    {
      method: "POST",
      body: {
        amount: "10000",
        reason: "Full token refund",
        payment_method: "cash",
        refund_date: WRITE_DATE,
      },
    },
  );
  const fullBody = await full.json();

  assert.equal(full.status, 201, JSON.stringify(fullBody));
  assert.equal(fullBody.data.payment.status, "refunded");

  const afterFull = await api(
    "manager",
    `/api/payments/${tokenPayment.uuid}/refund`,
    {
      method: "POST",
      body: {
        amount: "1",
        reason: "Nothing left",
        payment_method: "cash",
        refund_date: WRITE_DATE,
      },
    },
  );

  assert.equal(afterFull.status, 409);

  const ledgerResponse = await api(
    "viewer",
    `/api/transactions?start_date=${WRITE_DATE}&end_date=${WRITE_DATE}&limit=100`,
  );
  const ledgerBody = await ledgerResponse.json();
  const refundRows = ledgerBody.data.transactions.filter(
    (row) =>
      row.sourceType === "payment_reversal" &&
      row.sourceUuid !== null &&
      row.kind === "refund",
  );

  assert.ok(refundRows.length >= 2);
  assert.ok(refundRows.every((row) => row.direction === "debit"));
});

test("concurrent refunds cannot exceed the original payment", async () => {
  const makeRefund = () =>
    api("admin", `/api/payments/${downPaymentReceipt.uuid}/refund`, {
      method: "POST",
      body: {
        amount: "6000",
        reason: "Concurrent refund attempt",
        payment_method: "cash",
        refund_date: WRITE_DATE,
      },
    });

  const [first, second] = await Promise.all([makeRefund(), makeRefund()]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);

  assert.deepEqual(statuses, [201, 409]);

  const refunded = await query(
    `SELECT
       COALESCE(SUM(amount), 0) AS total,
       COUNT(*)::int AS count
     FROM payment_reversals
     WHERE original_payment_id = $1
       AND status IN ('pending', 'completed')`,
    [downPaymentReceipt.id],
  );

  assert.equal(Number(refunded.rows[0].total), 6000);
  assert.equal(refunded.rows[0].count, 1);

  const paymentResult = await query(
    "SELECT status FROM payments WHERE id = $1",
    [downPaymentReceipt.id],
  );

  assert.equal(paymentResult.rows[0].status, "partially_refunded");
});

// Cancellation.

let refundedCancellationBooking;
let plainCancellationBooking;

test("cancelling a booking releases the plot and refunds the token", async () => {
  const plot = await createPlot("P47-CANCEL");
  const createResponse = await createApiBooking(
    plot,
    4000,
    "p47test-booking-cancel",
  );
  const createBody = await createResponse.json();

  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  refundedCancellationBooking = createBody.data.booking;
  createdBookingIds.push(refundedCancellationBooking.id);

  const cancelResponse = await api(
    "manager",
    `/api/bookings/${refundedCancellationBooking.uuid}/cancel`,
    {
      method: "POST",
      body: {
        reason: "Customer changed their mind",
        refund_token: true,
        refund_method: "cash",
        refund_date: WRITE_DATE,
      },
    },
  );
  const cancelBody = await cancelResponse.json();

  assert.equal(cancelResponse.status, 200, JSON.stringify(cancelBody));
  assert.equal(cancelBody.data.booking.status, "cancelled");
  assert.ok(cancelBody.data.refund);
  assert.equal(Number(cancelBody.data.refund.amount), 4000);
  assert.equal(cancelBody.data.plot.status, "available");

  const plotAfter = await query("SELECT status FROM plots WHERE id = $1", [
    plot.id,
  ]);
  assert.equal(plotAfter.rows[0].status, "available");

  const tokenResult = await query(
    `SELECT status
     FROM payments
     WHERE booking_id = $1
       AND payment_purpose = 'booking_token'`,
    [refundedCancellationBooking.id],
  );

  assert.equal(tokenResult.rows[0].status, "refunded");

  const repeat = await api(
    "manager",
    `/api/bookings/${refundedCancellationBooking.uuid}/cancel`,
    {
      method: "POST",
      body: { reason: "Again", refund_token: false },
    },
  );

  assert.equal(repeat.status, 409);

  const rebook = await createApiBooking(plot, 0, "p47test-booking-rebook");
  const rebookBody = await rebook.json();

  assert.equal(rebook.status, 201, JSON.stringify(rebookBody));
  createdBookingIds.push(rebookBody.data.booking.id);
});

test("cancelling without a refund keeps the token receipt completed", async () => {
  const plot = await createPlot("P47-CANCEL-NOREFUND");
  const createResponse = await createApiBooking(
    plot,
    2000,
    "p47test-booking-plain-cancel",
  );
  const createBody = await createResponse.json();

  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  plainCancellationBooking = createBody.data.booking;
  createdBookingIds.push(plainCancellationBooking.id);

  const cancelResponse = await api(
    "admin",
    `/api/bookings/${plainCancellationBooking.uuid}/cancel`,
    {
      method: "POST",
      body: { reason: "No refund requested", refund_token: false, refund_method: null },
    },
  );
  const cancelBody = await cancelResponse.json();

  assert.equal(cancelResponse.status, 200, JSON.stringify(cancelBody));
  assert.equal(cancelBody.data.booking.status, "cancelled");
  assert.equal(cancelBody.data.refund, null);

  const tokenResult = await query(
    `SELECT status
     FROM payments
     WHERE booking_id = $1
       AND payment_purpose = 'booking_token'`,
    [plainCancellationBooking.id],
  );

  assert.equal(tokenResult.rows[0].status, "completed");
});

// Reconciliation and RBAC.

test("reconciliation reports consistent account and plan balances", async () => {
  const report = await reconcileFinance();

  assert.equal(report.accountMismatches.length, 0);

  const bank = report.accounts.find(
    (account) => Number(account.id) === Number(bankAccount.id),
  );

  assert.ok(bank);
  assert.equal(bank.discrepancy, 0);
  assert.equal(bank.ledger_balance, 11800);
  assert.equal(bank.computed_balance, 11800);

  assert.equal(
    report.planMismatches.some(
      (row) => Number(row.id) === Number(plan.id),
    ),
    false,
  );

  const paymentResult = await query(
    "SELECT id FROM payments WHERE booking_id = $1",
    [booking.id],
  );
  const paymentIds = new Set(
    paymentResult.rows.map((row) => Number(row.id)),
  );

  assert.equal(
    report.refundMismatches.some((row) => paymentIds.has(Number(row.id))),
    false,
  );
});

test("role matrix enforces finance permissions", async () => {
  const financeReadRoles = ["admin", "manager", "accountant", "sales", "viewer"];
  const accountingRoles = ["admin", "manager", "accountant"];
  const adminManagerRoles = ["admin", "manager"];

  const cases = [
    {
      method: "GET",
      path: "/api/transactions",
      allowed: financeReadRoles,
      allowedStatus: 200,
    },
    {
      method: "GET",
      path: `/api/transactions/payment/${tokenPayment.uuid}`,
      allowed: financeReadRoles,
      allowedStatus: 200,
    },
    {
      method: "GET",
      path: `/api/accounts/${bankAccount.uuid}/transactions`,
      allowed: financeReadRoles,
      allowedStatus: 200,
    },
    {
      method: "GET",
      path: "/api/transactions/export",
      allowed: accountingRoles,
      allowedStatus: 200,
    },
    {
      method: "GET",
      path: "/api/accounts/balances",
      allowed: accountingRoles,
      allowedStatus: 200,
    },
    {
      method: "POST",
      path: "/api/transactions",
      body: {},
      allowed: accountingRoles,
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/transactions/transfers",
      body: {},
      allowed: accountingRoles,
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/payments/received",
      body: {},
      allowed: accountingRoles,
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/payments/00000000-0000-4000-8000-000000000000/refund",
      body: {},
      allowed: adminManagerRoles,
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/bookings/create",
      body: {},
      allowed: ["admin", "manager", "sales"],
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/bookings/confirm/00000000-0000-4000-8000-000000000000",
      body: {},
      allowed: adminManagerRoles,
      allowedStatus: 400,
    },
    {
      method: "POST",
      path: "/api/bookings/00000000-0000-4000-8000-000000000000/cancel",
      body: {},
      allowed: adminManagerRoles,
      allowedStatus: 404,
    },
  ];

  for (const testCase of cases) {
    for (const role of testCase.allowed) {
      const response = await api(role, testCase.path, {
        method: testCase.method,
        body: testCase.body,
      });

      assert.equal(
        response.status,
        testCase.allowedStatus,
        `${role} should be allowed on ${testCase.method} ${testCase.path} (got ${response.status})`,
      );
    }

    for (const role of ALL_ROLES.filter(
      (candidate) => !testCase.allowed.includes(candidate),
    )) {
      const response = await api(role, testCase.path, {
        method: testCase.method,
        body: testCase.body,
      });

      assert.equal(
        response.status,
        403,
        `${role} should be denied on ${testCase.method} ${testCase.path} (got ${response.status})`,
      );
    }
  }
});
