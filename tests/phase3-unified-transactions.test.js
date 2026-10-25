"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const jwtService = require("../services/jwtService");
const { query, pool } = require("../config/db");

const LEDGER_DATE = "2035-01-01";

let server;
let baseUrl;
let authCookie;

let bankAccount;
let cashAccount;
let projectedBooking;
let financialIncome;
let financialExpense;

const createdProjectIds = [];
const createdPlotIds = [];
const createdLeadIds = [];
const createdBookingIds = [];
const createdPaymentIds = [];
const createdFinancialTransactionIds = [];
const createdCategoryIds = [];
const createdPartyIds = [];
const createdAccountIds = [];

function authed(options = {}) {
  return {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: authCookie,
      ...(options.headers || {}),
    },
  };
}

function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function createBooking({ plotId, projectId, leadId, tokenAmount = 0 }) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const result = await query(
    `INSERT INTO bookings (
       booking_number, project_id, plot_id, lead_id, booking_date,
       agreed_price, total_amount, booking_amount, status
     )
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 50000, 50000, $5, 'pending')
     RETURNING id, uuid, booking_number`,
    [`BK-P3-${suffix}`, projectId, plotId, leadId, tokenAmount],
  );

  createdBookingIds.push(result.rows[0].id);
  return result.rows[0];
}

async function createPayment({
  bookingId,
  accountId,
  paymentNumber,
  amount,
  purpose,
  method,
  status = "completed",
}) {
  const result = await query(
    `INSERT INTO payments (
       payment_number, booking_id, customer_id, installment_id,
       account_id, payment_method, amount, payment_date,
       status, payment_purpose, notes
     )
     VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6::timestamptz, $7, $8, $9)
     RETURNING id, uuid`,
    [
      paymentNumber,
      bookingId,
      accountId,
      method,
      amount,
      `${LEDGER_DATE}T10:00:00Z`,
      status,
      purpose,
      `Phase 3 fixture ${paymentNumber}`,
    ],
  );

  createdPaymentIds.push(result.rows[0].id);
  return result.rows[0];
}

async function createFinancialTransaction({
  accountId,
  partyId,
  categoryId,
  transactionNumber,
  transactionType,
  amount,
  status = "posted",
  method = "cash",
}) {
  const result = await query(
    `INSERT INTO financial_transactions (
       transaction_number, transaction_type, account_id, party_id,
       category_id, amount, transaction_date, payment_method, status,
       reference_number, notes, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, 1)
     RETURNING id, uuid`,
    [
      transactionNumber,
      transactionType,
      accountId,
      partyId,
      categoryId,
      amount,
      `${LEDGER_DATE}T12:00:00Z`,
      method,
      status,
      `REF-${transactionNumber}`,
      `Phase 3 fixture ${transactionNumber}`,
    ],
  );

  createdFinancialTransactionIds.push(result.rows[0].id);
  return result.rows[0];
}

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Phase 3 transaction tests write to the database and must not run in production",
    );
  }

  const token = await jwtService.signJwt({
    id: 1,
    role: "admin",
    name: "Phase 3 Test Admin",
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

  const cashResult = await query(
    "SELECT id, uuid FROM accounts WHERE account_type = 'cash' AND is_active = TRUE LIMIT 1",
  );
  cashAccount = cashResult.rows[0];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const bankResult = await query(
    `INSERT INTO accounts (
       account_name, bank_name, account_type, opening_balance
     )
     VALUES ($1, 'Phase 3 Bank', 'bank', 1000)
     RETURNING id, uuid`,
    [`Phase 3 Bank ${suffix}`],
  );
  bankAccount = bankResult.rows[0];
  createdAccountIds.push(bankAccount.id);

  const projectResult = await query(
    `INSERT INTO projects (name, city, total_area, plots, status)
     VALUES ($1, 'Test City', 10000, 10, 'planning')
     RETURNING id`,
    [`Phase 3 Project ${suffix}`],
  );
  createdProjectIds.push(projectResult.rows[0].id);

  const createTestPlot = async (label) => {
    const result = await query(
      `INSERT INTO plots (
         project_id, plot_number, status, base_price, length, breadth
       )
       VALUES ($1, $2, 'available', 50000, 30, 40)
       RETURNING id`,
      [projectResult.rows[0].id, `${label}-${suffix}`],
    );
    createdPlotIds.push(result.rows[0].id);
    return result.rows[0];
  };

  const plotResult = await createTestPlot("P3-PLOT");
  const secondPlot = await createTestPlot("P3-PLOT-B");
  const thirdPlot = await createTestPlot("P3-PLOT-C");

  const leadResult = await query(
    `INSERT INTO leads (name, phone, project_id, plot_id)
     VALUES ('Phase 3 Test Lead', $1, $2, $3)
     RETURNING id`,
    [
      `8${Math.floor(100000000 + Math.random() * 899999999)}`,
      projectResult.rows[0].id,
      plotResult.id,
    ],
  );
  createdLeadIds.push(leadResult.rows[0].id);

  projectedBooking = await createBooking({
    plotId: plotResult.id,
    projectId: projectResult.rows[0].id,
    leadId: leadResult.rows[0].id,
    tokenAmount: 5000,
  });

  const secondBooking = await createBooking({
    plotId: secondPlot.id,
    projectId: projectResult.rows[0].id,
    leadId: leadResult.rows[0].id,
  });

  const thirdBooking = await createBooking({
    plotId: thirdPlot.id,
    projectId: projectResult.rows[0].id,
    leadId: leadResult.rows[0].id,
  });

  await createPayment({
    bookingId: projectedBooking.id,
    accountId: cashAccount.id,
    paymentNumber: `PAY-P3-TOKEN-${suffix}`,
    amount: 5000,
    purpose: "booking_token",
    method: "cash",
  });

  await createPayment({
    bookingId: secondBooking.id,
    accountId: bankAccount.id,
    paymentNumber: `PAY-P3-INST-${suffix}`,
    amount: 7000,
    purpose: "installment",
    method: "bank_transfer",
  });

  await createPayment({
    bookingId: thirdBooking.id,
    accountId: cashAccount.id,
    paymentNumber: `PAY-P3-PARTIAL-${suffix}`,
    amount: 4000,
    purpose: "installment",
    method: "cash",
    status: "partially_refunded",
  });

  const categoryResult = await query(
    `INSERT INTO transaction_categories (name, description, created_by)
     VALUES ($1, 'Phase 3 test category', 1)
     RETURNING id`,
    [`Phase 3 Category ${suffix}`],
  );
  createdCategoryIds.push(categoryResult.rows[0].id);

  const partyResult = await query(
    `INSERT INTO parties (name, party_type, phone, created_by)
     VALUES ('Phase 3 Party', 'vendor', $1, 1)
     RETURNING id`,
    [`7${Math.floor(100000000 + Math.random() * 899999999)}`],
  );
  createdPartyIds.push(partyResult.rows[0].id);

  financialIncome = await createFinancialTransaction({
    accountId: cashAccount.id,
    partyId: partyResult.rows[0].id,
    categoryId: categoryResult.rows[0].id,
    transactionNumber: `TXN-P3-INC-${suffix}`,
    transactionType: "income",
    amount: 3000,
    method: "cash",
  });

  financialExpense = await createFinancialTransaction({
    accountId: bankAccount.id,
    partyId: partyResult.rows[0].id,
    categoryId: categoryResult.rows[0].id,
    transactionNumber: `TXN-P3-EXP-${suffix}`,
    transactionType: "expense",
    amount: 500,
    method: "bank_transfer",
  });

  await createFinancialTransaction({
    accountId: bankAccount.id,
    partyId: partyResult.rows[0].id,
    categoryId: categoryResult.rows[0].id,
    transactionNumber: `TXN-P3-INC-BANK-${suffix}`,
    transactionType: "income",
    amount: 2000,
    method: "bank_transfer",
  });

  await createFinancialTransaction({
    accountId: cashAccount.id,
    partyId: partyResult.rows[0].id,
    categoryId: categoryResult.rows[0].id,
    transactionNumber: `TXN-P3-EXP-CASH-${suffix}`,
    transactionType: "expense",
    amount: 1000,
    method: "cash",
  });

  await createFinancialTransaction({
    accountId: cashAccount.id,
    partyId: partyResult.rows[0].id,
    categoryId: categoryResult.rows[0].id,
    transactionNumber: `TXN-P3-PENDING-${suffix}`,
    transactionType: "income",
    amount: 9000,
    status: "pending",
    method: "cash",
  });
});

after(async () => {
  for (const id of createdFinancialTransactionIds) {
    await query("DELETE FROM financial_transactions WHERE id = $1", [id]);
  }
  for (const id of createdPaymentIds) {
    await query("DELETE FROM payments WHERE id = $1", [id]);
  }
  for (const id of createdBookingIds) {
    await query("DELETE FROM bookings WHERE id = $1", [id]);
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
  for (const id of createdCategoryIds) {
    await query("DELETE FROM transaction_categories WHERE id = $1", [id]);
  }
  for (const id of createdPartyIds) {
    await query("DELETE FROM parties WHERE id = $1", [id]);
  }
  for (const id of createdAccountIds) {
    await query("DELETE FROM accounts WHERE id = $1", [id]);
  }

  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await pool.end();
});

test("unified transaction list returns payments and financial rows with a channel split", async () => {
  const response = await request(
    `/api/transactions?start_date=${LEDGER_DATE}&end_date=${LEDGER_DATE}&limit=100`,
    authed(),
  );

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.transactions));
  assert.equal(body.data.transactions.length, 8);
  assert.equal(body.data.pagination.total, 8);

  const summary = body.data.summary;

  assert.equal(Number(summary.totalTransactions), 8);
  assert.equal(Number(summary.totalInflow), 21000);
  assert.equal(Number(summary.totalOutflow), 1500);
  assert.equal(Number(summary.netFlow), 19500);
  assert.equal(Number(summary.cashInflow), 12000);
  assert.equal(Number(summary.cashOutflow), 1000);
  assert.equal(Number(summary.cashNet), 11000);
  assert.equal(Number(summary.bankInflow), 9000);
  assert.equal(Number(summary.bankOutflow), 500);
  assert.equal(Number(summary.bankNet), 8500);
  assert.equal(Number(summary.completedTotal), 17000);
  assert.equal(Number(summary.pendingTotal), 9000);
  assert.equal(Number(summary.refundedTotal), 4000);

  const sourceTypes = new Set(
    body.data.transactions.map((transaction) => transaction.sourceType),
  );
  assert.deepEqual(
    [...sourceTypes].sort(),
    ["financial_transaction", "payment"],
  );

  const pending = body.data.transactions.find(
    (transaction) => transaction.status === "pending",
  );
  assert.ok(pending);
  assert.equal(pending.countsAsBalance, false);
  assert.equal(pending.countsAsCashFlow, false);
});

test("unified transaction filters cover channel, source, kind and direction", async () => {
  const base = `/api/transactions?start_date=${LEDGER_DATE}&end_date=${LEDGER_DATE}&limit=100`;

  const cashResponse = await request(`${base}&channel=cash`, authed());
  const cashBody = await cashResponse.json();
  assert.equal(cashResponse.status, 200);
  assert.equal(cashBody.data.transactions.length, 5);
  assert.ok(
    cashBody.data.transactions.every(
      (transaction) => transaction.channel === "cash",
    ),
  );

  const financialResponse = await request(
    `${base}&source_type=financial_transaction`,
    authed(),
  );
  const financialBody = await financialResponse.json();
  assert.equal(financialBody.data.transactions.length, 5);
  assert.ok(
    financialBody.data.transactions.every(
      (transaction) => transaction.sourceType === "financial_transaction",
    ),
  );

  const installmentResponse = await request(
    `${base}&kind=installment`,
    authed(),
  );
  const installmentBody = await installmentResponse.json();
  assert.equal(installmentBody.data.transactions.length, 2);

  const debitResponse = await request(`${base}&direction=debit`, authed());
  const debitBody = await debitResponse.json();
  assert.equal(debitBody.data.transactions.length, 2);
  assert.ok(
    debitBody.data.transactions.every(
      (transaction) => transaction.direction === "debit",
    ),
  );

  const invalidResponse = await request(`${base}&channel=wallet`, authed());
  assert.equal(invalidResponse.status, 400);
});

test("transaction detail resolves payment and financial records", async () => {
  const paymentResult = await query(
    "SELECT uuid FROM payments WHERE id = $1",
    [createdPaymentIds[0]],
  );
  const paymentResponse = await request(
    `/api/transactions/payment/${paymentResult.rows[0].uuid}`,
    authed(),
  );
  const paymentBody = await paymentResponse.json();

  assert.equal(paymentResponse.status, 200);
  assert.equal(paymentBody.data.transaction.sourceType, "payment");
  assert.equal(Number(paymentBody.data.transaction.amount), 5000);
  assert.equal(paymentBody.data.transaction.kind, "booking_token");

  const financialResult = await query(
    "SELECT uuid FROM financial_transactions WHERE id = $1",
    [financialIncome.id],
  );
  const financialResponse = await request(
    `/api/transactions/financial_transaction/${financialResult.rows[0].uuid}`,
    authed(),
  );
  const financialBody = await financialResponse.json();

  assert.equal(financialResponse.status, 200);
  assert.equal(
    financialBody.data.transaction.sourceType,
    "financial_transaction",
  );
  assert.equal(financialBody.data.transaction.kind, "income");
  assert.ok(financialBody.data.transaction.categoryName);

  const invalidSource = await request(
    `/api/transactions/refund/${financialResult.rows[0].uuid}`,
    authed(),
  );
  assert.equal(invalidSource.status, 400);

  const missing = await request(
    "/api/transactions/payment/00000000-0000-4000-8000-000000000000",
    authed(),
  );
  assert.equal(missing.status, 404);

  const invalidUuid = await request(
    "/api/transactions/payment/not-a-uuid",
    authed(),
  );
  assert.equal(invalidUuid.status, 400);
});

test("account balances derive current balance from opening balance and eligible rows", async () => {
  const response = await request("/api/accounts/balances", authed());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.accounts));

  const bank = body.data.accounts.find(
    (account) => account.id === bankAccount.id,
  );

  assert.ok(bank);
  assert.equal(Number(bank.opening_balance), 1000);
  assert.equal(Number(bank.current_balance), 9500);
  assert.equal(Number(bank.total_inflow), 9000);
  assert.equal(Number(bank.total_outflow), 500);
  assert.equal(Number(bank.net_flow), 8500);

  const summedBalance = body.data.accounts.reduce(
    (sum, account) => sum + Number(account.current_balance),
    0,
  );

  assert.equal(
    Number(body.data.totals.combined.balance.toFixed(2)),
    Number(summedBalance.toFixed(2)),
  );
});

test("account history reads both payments and financial transactions", async () => {
  const response = await request(
    `/api/accounts/${bankAccount.uuid}/transactions?start_date=${LEDGER_DATE}&end_date=${LEDGER_DATE}`,
    authed(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.account.current_balance, 9500);
  assert.equal(body.data.transactions.length, 3);

  const kinds = new Set(
    body.data.transactions.map((transaction) => transaction.kind),
  );
  assert.deepEqual([...kinds].sort(), ["expense", "income", "installment"]);

  assert.equal(Number(body.data.summary.totalInflow), 9000);
  assert.equal(Number(body.data.summary.totalOutflow), 500);
  assert.equal(Number(body.data.summary.totalTransactions), 3);

  const badDate = await request(
    `/api/accounts/${bankAccount.uuid}/transactions?start_date=not-a-date`,
    authed(),
  );
  assert.equal(badDate.status, 400);

  const badKind = await request(
    `/api/accounts/${bankAccount.uuid}/transactions?kind=wallet`,
    authed(),
  );
  assert.equal(badKind.status, 400);
});

test("export returns the same unified rows as the list", async () => {
  const response = await request(
    `/api/transactions/export?start_date=${LEDGER_DATE}&end_date=${LEDGER_DATE}`,
    authed(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.count, 8);

  const financial = body.data.find(
    (transaction) => transaction.sourceType === "financial_transaction",
  );
  assert.ok(financial);
  assert.ok(financial.transactionNumber);
});
