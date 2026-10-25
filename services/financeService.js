"use strict";

const PAYMENT_METHODS = [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "cheque",
  "other",
];

const SEQUENCE_SOURCES = {
  financial_transactions: {
    table: "financial_transactions",
    column: "transaction_number",
    lockKey: 71342,
  },
  account_transfers: {
    table: "account_transfers",
    column: "transfer_number",
    lockKey: 71343,
  },
  payment_reversals: {
    table: "payment_reversals",
    column: "reversal_number",
    lockKey: 71344,
  },
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isPositiveInteger = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  /^\d+$/.test(String(value)) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;

const isUniqueViolation = (error) => error?.code === "23505";

const isIdempotencyViolation = (error) =>
  isUniqueViolation(error) &&
  (error.constraint === "uq_idempotency_keys_key_scope" ||
    String(error.detail || "").includes("(key, scope)"));

/**
 * Resolve the account that will receive or pay money.
 *
 * Cash is special: there is exactly one active Cash in Hand account and the
 * caller cannot redirect a cash receipt to a bank account. Non-cash methods
 * require an explicit, active bank account.
 */
async function resolveAccount(
  client,
  { paymentMethod, accountId, lock = true } = {},
) {
  const method = String(paymentMethod || "").trim();

  if (!PAYMENT_METHODS.includes(method)) {
    throw createError("A valid payment method is required.", 400);
  }

  if (method === "cash") {
    const result = await client.query(
      `SELECT id, uuid, account_name, account_type, bank_name, is_active
       FROM accounts
       WHERE account_type = 'cash'
         AND is_active = TRUE
       ORDER BY id
       LIMIT 1
       ${lock ? "FOR SHARE" : ""}`,
    );

    if (result.rowCount === 0) {
      throw createError(
        "No active Cash in Hand account exists. Create one before recording cash payments.",
        400,
      );
    }

    return result.rows[0];
  }

  if (!isPositiveInteger(accountId)) {
    throw createError(
      "A bank account is required for non-cash payments.",
      400,
    );
  }

  const result = await client.query(
    `SELECT id, uuid, account_name, account_type, bank_name, is_active
     FROM accounts
     WHERE id = $1
     ${lock ? "FOR SHARE" : ""}`,
    [accountId],
  );

  const account = result.rows[0];

  if (!account) {
    throw createError("The selected account was not found.", 400);
  }

  if (!account.is_active) {
    throw createError("The selected account is not active.", 400);
  }

  if (account.account_type !== "bank") {
    throw createError("Non-cash payments require a bank account.", 400);
  }

  return account;
}

/**
 * Current ledger balance for one account.
 *
 * The unified view decides which rows count towards a balance, so overdraw
 * checks use exactly the same definition as the ledger and reconciliation.
 */
async function getAccountBalance(client, accountId) {
  const result = await client.query(
    `SELECT
       COALESCE(a.opening_balance, 0) + COALESCE(SUM(
         CASE
           WHEN v.counts_as_balance THEN
             CASE
               WHEN v.direction = 'credit' THEN v.amount
               ELSE -v.amount
             END
           ELSE 0
         END
       ), 0) AS balance
     FROM accounts a
     LEFT JOIN v_unified_transactions v ON v.account_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, a.opening_balance`,
    [accountId],
  );

  if (result.rowCount === 0) {
    throw createError("The selected account was not found.", 400);
  }

  return Number(result.rows[0].balance);
}

/**
 * Lock an account row before reading its balance.
 *
 * Outflows must hold this lock until commit so two concurrent requests cannot
 * both observe the same pre-payment balance.
 */
async function lockAccountForBalance(client, accountId) {
  const result = await client.query(
    `SELECT id, account_name
     FROM accounts
     WHERE id = $1
     FOR UPDATE`,
    [accountId],
  );

  const account = result.rows[0];

  if (!account) {
    throw createError("The selected account was not found.", 400);
  }

  return {
    ...account,
    balance: await getAccountBalance(client, account.id),
  };
}

/**
 * Reject an outflow that would take an account below zero.
 *
 * The account row stays locked until the caller commits, which serialises
 * concurrent outflows against the same account.
 */
async function assertSufficientBalance(client, { accountId, amount }) {
  const required = Number(amount);

  if (!Number.isFinite(required) || required <= 0) {
    throw createError("A valid amount is required.", 400);
  }

  const account = await lockAccountForBalance(client, accountId);

  if (account.balance < required) {
    throw createError(`Insufficient balance in ${account.account_name}`, 409);
  }

  return account.balance;
}

/**
 * Generate a gap-free yearly sequence number inside the current transaction.
 * The advisory lock serialises concurrent writers for the same source/year.
 */
async function generateSequenceNumber(client, { source, prefix, year }) {
  const config = SEQUENCE_SOURCES[source];

  if (!config) {
    throw createError("Unknown sequence source.", 500);
  }

  const sequenceYear = Number(year);
  const normalizedPrefix = String(prefix || "").toUpperCase();

  if (
    !/^[A-Z]{2,6}$/.test(normalizedPrefix) ||
    !Number.isInteger(sequenceYear) ||
    sequenceYear < 2000 ||
    sequenceYear > 9999
  ) {
    throw createError("Unable to generate a sequence number.", 500);
  }

  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    config.lockKey,
    sequenceYear,
  ]);

  const likePattern = `${normalizedPrefix}-${sequenceYear}-%`;
  const result = await client.query(
    `SELECT ${config.column} AS number
     FROM ${config.table}
     WHERE ${config.column} LIKE $1
     ORDER BY id DESC
     LIMIT 1`,
    [likePattern],
  );

  const lastNumber = result.rows[0]?.number;
  const lastSequence = lastNumber
    ? Number(String(lastNumber).split("-").pop())
    : 0;

  if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
    throw createError("Unable to generate a sequence number.", 500);
  }

  return `${normalizedPrefix}-${sequenceYear}-${String(
    lastSequence + 1,
  ).padStart(4, "0")}`;
}

/**
 * The idempotency key can arrive as a header (preferred) or in the body for
 * clients that cannot set headers.
 */
function getIdempotencyKey(req) {
  const headerValue =
    req?.get?.("Idempotency-Key") ||
    req?.headers?.["idempotency-key"] ||
    req?.headers?.["Idempotency-Key"];
  const bodyValue = req?.body?.idempotency_key;
  const value = headerValue ?? bodyValue;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw createError("Idempotency-Key must be a non-empty string.", 400);
  }

  if (value.trim().length > 255) {
    throw createError("Idempotency-Key cannot exceed 255 characters.", 400);
  }

  return value.trim();
}

async function findIdempotentResource(client, idempotencyKey, scope) {
  if (!idempotencyKey) {
    return null;
  }

  const result = await client.query(
    `SELECT resource_uuid
     FROM idempotency_keys
     WHERE key = $1
       AND scope = $2
     LIMIT 1`,
    [idempotencyKey, scope],
  );

  return result.rows[0]?.resource_uuid || null;
}

async function recordIdempotencyKey(
  client,
  idempotencyKey,
  scope,
  resourceUuid,
) {
  if (!idempotencyKey) {
    return;
  }

  await client.query(
    `INSERT INTO idempotency_keys (key, scope, resource_uuid)
     VALUES ($1, $2, $3)`,
    [idempotencyKey, scope, resourceUuid],
  );
}

module.exports = {
  PAYMENT_METHODS,
  createError,
  isPositiveInteger,
  isUniqueViolation,
  isIdempotencyViolation,
  resolveAccount,
  getAccountBalance,
  lockAccountForBalance,
  assertSufficientBalance,
  generateSequenceNumber,
  getIdempotencyKey,
  findIdempotentResource,
  recordIdempotencyKey,
};
