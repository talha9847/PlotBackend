"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const jwtService = require("../services/jwtService");
const { query, pool } = require("../config/db");

let server;
let baseUrl;
let authCookie;
let createdBankAccountId = null;
let createdCashAccountId = null;

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Phase 1 account tests write to the database and must not run in production",
    );
  }

  const token = await jwtService.signJwt({
    id: 1,
    role: "admin",
    name: "Phase 1 Test",
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
  for (const id of [createdBankAccountId, createdCashAccountId]) {
    if (id) {
      await query("DELETE FROM accounts WHERE id = $1", [id]);
    }
  }

  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await pool.end();
});

function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

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

test("accounts list requires authentication", async () => {
  const response = await request("/api/accounts");

  assert.equal(response.status, 401);
});

test("accounts list exposes one cash account and typed bank accounts", async () => {
  const response = await request("/api/accounts", authed());

  assert.equal(response.status, 200);

  const body = await response.json();
  const accounts = body.data.accounts;

  assert.ok(Array.isArray(accounts));

  const cashAccounts = accounts.filter(
    (account) => account.account_type === "cash",
  );

  assert.equal(cashAccounts.length, 1);
  assert.equal(cashAccounts[0].bank_name, null);
  assert.equal(cashAccounts[0].is_active, true);
  assert.equal(accounts[0].account_type, "cash");

  for (const account of accounts) {
    assert.ok(["cash", "bank"].includes(account.account_type));

    if (account.account_type === "bank") {
      assert.ok(account.bank_name);
    }
  }
});

test("the database holds exactly one active cash account", async () => {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM accounts
     WHERE account_type = 'cash'
       AND is_active = TRUE`,
  );

  assert.equal(result.rows[0].count, 1);
});

test("the database rejects a second active cash account", async () => {
  await assert.rejects(
    () =>
      query(
        `INSERT INTO accounts (account_name, bank_name, account_type)
         VALUES ('Duplicate Active Cash', NULL, 'cash')`,
      ),
    /uq_accounts_single_active_cash|duplicate key/,
  );
});

test("creating a second cash account is rejected", async () => {
  const response = await request(
    "/api/accounts/create",
    authed({
      method: "POST",
      body: JSON.stringify({
        account_name: "Second Cash Till",
        bank_name: "Some Bank",
        account_type: "cash",
      }),
    }),
  );

  assert.equal(response.status, 400);

  const body = await response.json();

  assert.equal(body.success, false);
  assert.match(body.message, /Cash in Hand/);
});

test("creating a bank account requires a bank name", async () => {
  const response = await request(
    "/api/accounts/create",
    authed({
      method: "POST",
      body: JSON.stringify({ account_name: "No Bank Name" }),
    }),
  );

  assert.equal(response.status, 400);
});

test("opening balance cannot be negative", async () => {
  const response = await request(
    "/api/accounts/create",
    authed({
      method: "POST",
      body: JSON.stringify({
        account_name: "Negative Opening",
        bank_name: "Test Bank",
        opening_balance: -1,
      }),
    }),
  );

  assert.equal(response.status, 400);

  const body = await response.json();

  assert.match(body.message, /Opening balance/);
});

test("account type cannot be changed through the update endpoint", async () => {
  const response = await request(
    "/api/accounts/999999999",
    authed({
      method: "PUT",
      body: JSON.stringify({
        account_name: "Attempted Switch",
        bank_name: "Test Bank",
        account_type: "cash",
      }),
    }),
  );

  assert.equal(response.status, 400);

  const body = await response.json();

  assert.match(body.message, /cannot be changed/);
});

test("updating an unknown account returns 404", async () => {
  const response = await request(
    "/api/accounts/999999999",
    authed({
      method: "PUT",
      body: JSON.stringify({
        account_name: "Missing Account",
        bank_name: "Test Bank",
      }),
    }),
  );

  assert.equal(response.status, 404);
});

test("bank account create and update round-trip", async () => {
  const unique = Date.now();
  const accountName = `Phase 1 Bank ${unique}`;

  const createResponse = await request(
    "/api/accounts/create",
    authed({
      method: "POST",
      body: JSON.stringify({
        account_name: accountName,
        bank_name: "Test Bank",
        opening_balance: "1234.56",
      }),
    }),
  );

  assert.equal(createResponse.status, 201);

  const createBody = await createResponse.json();
  const created = createBody.data.account;

  createdBankAccountId = created.id;

  assert.equal(created.account_type, "bank");
  assert.equal(created.bank_name, "Test Bank");
  assert.equal(String(created.opening_balance), "1234.56");
  assert.equal(created.is_active, true);

  const missingBankResponse = await request(
    `/api/accounts/${created.id}`,
    authed({
      method: "PUT",
      body: JSON.stringify({ account_name: accountName }),
    }),
  );

  assert.equal(missingBankResponse.status, 400);

  const updateResponse = await request(
    `/api/accounts/${created.id}`,
    authed({
      method: "PUT",
      body: JSON.stringify({
        account_name: `${accountName} Updated`,
        bank_name: "Test Bank Updated",
        opening_balance: "2000.50",
      }),
    }),
  );

  assert.equal(updateResponse.status, 200);

  const updateBody = await updateResponse.json();
  const updated = updateBody.data.account;

  assert.equal(updated.account_name, `${accountName} Updated`);
  assert.equal(updated.bank_name, "Test Bank Updated");
  assert.equal(String(updated.opening_balance), "2000.50");
  assert.equal(updated.account_type, "bank");
});

test("cash account update keeps bank name null", async () => {
  const insert = await query(
    `INSERT INTO accounts (
       account_name,
       bank_name,
       account_type,
       opening_balance,
       is_active
     )
     VALUES ('Phase 1 Inactive Cash', NULL, 'cash', 0, FALSE)
     RETURNING id`,
  );

  createdCashAccountId = insert.rows[0].id;

  const response = await request(
    `/api/accounts/${createdCashAccountId}`,
    authed({
      method: "PUT",
      body: JSON.stringify({
        account_name: "Phase 1 Cash Updated",
        opening_balance: "75.25",
      }),
    }),
  );

  assert.equal(response.status, 200);

  const body = await response.json();
  const updated = body.data.account;

  assert.equal(updated.account_name, "Phase 1 Cash Updated");
  assert.equal(updated.account_type, "cash");
  assert.equal(updated.bank_name, null);
  assert.equal(String(updated.opening_balance), "75.25");
});

test("cash account rejects a bank name on update", async () => {
  assert.ok(createdCashAccountId);

  const response = await request(
    `/api/accounts/${createdCashAccountId}`,
    authed({
      method: "PUT",
      body: JSON.stringify({
        account_name: "Phase 1 Cash Updated",
        bank_name: "Should Not Apply",
      }),
    }),
  );

  assert.equal(response.status, 400);

  const body = await response.json();

  assert.match(body.message, /Cash accounts cannot have a bank name/);
});
