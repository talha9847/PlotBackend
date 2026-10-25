"use strict";

const { query, pool } = require("../config/db");
const {
  resolveAccount,
  assertSufficientBalance,
  generateSequenceNumber,
  findIdempotentResource,
  recordIdempotencyKey,
  isIdempotencyViolation,
  PAYMENT_METHODS,
  createError,
} = require("./financeService");

const SOURCE_TYPES = [
  "payment",
  "financial_transaction",
  "account_transfer",
  "payment_reversal",
];
const KINDS = [
  "booking_token",
  "down_payment",
  "installment",
  "income",
  "expense",
  "transfer",
  "refund",
];
const DIRECTIONS = ["credit", "debit"];
const CHANNELS = ["cash", "bank"];
const STATUSES = [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
];

const SORT_COLUMNS = {
  date: "v.transaction_date",
  amount: "v.amount",
  customer: "COALESCE(l.name, pt.name, '')",
  number: "v.transaction_number",
  status: "v.status",
};

const FROM_SQL = `
  FROM v_unified_transactions v
  LEFT JOIN accounts a
    ON a.id = v.account_id
  LEFT JOIN bookings b
    ON b.id = v.booking_id
  LEFT JOIN customers c
    ON c.id = v.customer_id
  LEFT JOIN leads l
    ON l.id = COALESCE(c.lead_id, b.lead_id)
    AND l.deleted_at IS NULL
  LEFT JOIN projects pr
    ON pr.id = b.project_id
    AND pr.deleted_at IS NULL
  LEFT JOIN plots pl
    ON pl.id = b.plot_id
    AND pl.deleted_at IS NULL
  LEFT JOIN users u
    ON u.id = v.created_by
    AND u.deleted_at IS NULL
  LEFT JOIN parties pt
    ON pt.id = v.party_id
    AND pt.deleted_at IS NULL
  LEFT JOIN transaction_categories cat
    ON cat.id = v.category_id
  LEFT JOIN installments i
    ON i.id = v.installment_id
  LEFT JOIN customer_plans cp
    ON cp.id = i.customer_plan_id
`;

const SELECT_SQL = `
  SELECT
    v.source_type AS "sourceType",
    v.source_uuid AS "sourceUuid",
    v.source_row_id AS "sourceRowId",
    v.transaction_number AS "transactionNumber",
    v.kind,
    v.direction,
    v.amount,
    v.account_id AS "accountId",
    a.uuid AS "accountUuid",
    a.account_name AS "accountName",
    a.bank_name AS "bankName",
    v.channel,
    v.status,
    v.payment_method AS "paymentMethod",
    v.booking_id AS "bookingId",
    b.uuid AS "bookingUuid",
    b.booking_number AS "bookingNumber",
    v.customer_id AS "customerId",
    c.uuid AS "customerUuid",
    l.name AS "customerName",
    l.phone AS "customerPhone",
    COALESCE(l.name, pt.name) AS "displayPartyName",
    v.party_id AS "partyId",
    pt.uuid AS "partyUuid",
    pt.name AS "partyName",
    v.category_id AS "categoryId",
    cat.uuid AS "categoryUuid",
    cat.name AS "categoryName",
    v.installment_id AS "installmentId",
    i.uuid AS "installmentUuid",
    i.installment_number AS "installmentNumber",
    cp.installment_count AS "installmentCount",
    b.project_id AS "projectId",
    pr.uuid AS "projectUuid",
    pr.name AS "projectName",
    b.plot_id AS "plotId",
    pl.uuid AS "plotUuid",
    pl.plot_number AS "plotNumber",
    v.created_by AS "createdBy",
    u.full_name AS "createdByName",
    v.transaction_date AS "transactionDate",
    v.reference_number AS "referenceNumber",
    v.notes,
    v.counts_as_balance AS "countsAsBalance",
    v.counts_as_cash_flow AS "countsAsCashFlow",
    v.created_at AS "createdAt",
    v.updated_at AS "updatedAt"
  ${FROM_SQL}
`;

function buildTransactionFilters(filters = {}) {
  const conditions = [];
  const values = [];

  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const {
    search,
    source_type,
    kind,
    direction,
    channel,
    customer_id,
    project_id,
    plot_id,
    account_id,
    party_id,
    category_id,
    payment_method,
    status,
    start_date,
    end_date,
    min_amount,
    max_amount,
  } = filters;

  if (search?.trim()) {
    const param = add(`%${search.trim()}%`);

    conditions.push(`(
      v.transaction_number ILIKE ${param}
      OR COALESCE(v.reference_number, '') ILIKE ${param}
      OR COALESCE(v.notes, '') ILIKE ${param}
      OR COALESCE(l.name, '') ILIKE ${param}
      OR COALESCE(l.phone, '') ILIKE ${param}
      OR COALESCE(pt.name, '') ILIKE ${param}
      OR COALESCE(cat.name, '') ILIKE ${param}
      OR COALESCE(b.booking_number, '') ILIKE ${param}
      OR COALESCE(pr.name, '') ILIKE ${param}
      OR COALESCE(pl.plot_number, '') ILIKE ${param}
      OR COALESCE(a.account_name, '') ILIKE ${param}
      OR v.payment_method ILIKE ${param}
      OR v.kind ILIKE ${param}
      OR v.source_type ILIKE ${param}
      OR v.status ILIKE ${param}
    )`);
  }

  if (source_type) {
    conditions.push(`v.source_type = ${add(source_type)}`);
  }

  if (kind) {
    conditions.push(`v.kind = ${add(kind)}`);
  }

  if (direction) {
    conditions.push(`v.direction = ${add(direction)}`);
  }

  if (channel) {
    conditions.push(`v.channel = ${add(channel)}`);
  }

  if (customer_id) {
    conditions.push(`v.customer_id = ${add(customer_id)}`);
  }

  if (project_id) {
    conditions.push(`b.project_id = ${add(project_id)}`);
  }

  if (plot_id) {
    conditions.push(`b.plot_id = ${add(plot_id)}`);
  }

  if (account_id) {
    conditions.push(`v.account_id = ${add(account_id)}`);
  }

  if (party_id) {
    conditions.push(`v.party_id = ${add(party_id)}`);
  }

  if (category_id) {
    conditions.push(`v.category_id = ${add(category_id)}`);
  }

  if (payment_method) {
    conditions.push(`v.payment_method = ${add(payment_method)}`);
  }

  if (status) {
    conditions.push(`v.status = ${add(status)}`);
  }

  if (start_date) {
    conditions.push(`v.transaction_date >= ${add(start_date)}::date`);
  }

  if (end_date) {
    conditions.push(
      `v.transaction_date < (${add(end_date)}::date + INTERVAL '1 day')`,
    );
  }

  if (min_amount !== undefined && min_amount !== "") {
    conditions.push(`v.amount >= ${add(min_amount)}`);
  }

  if (max_amount !== undefined && max_amount !== "") {
    conditions.push(`v.amount <= ${add(max_amount)}`);
  }

  return {
    where: conditions.length > 0 ? conditions.join(" AND ") : "TRUE",
    values,
  };
}

function buildSummarySql(where) {
  return `
    SELECT
      COUNT(*)::int AS "totalTransactions",

      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow AND v.direction = 'credit'
      ), 0) AS "totalInflow",
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow AND v.direction = 'debit'
      ), 0) AS "totalOutflow",
      COALESCE(SUM(
        CASE
          WHEN v.counts_as_cash_flow THEN
            CASE WHEN v.direction = 'credit' THEN v.amount ELSE -v.amount END
          ELSE 0
        END
      ), 0) AS "netFlow",

      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow
          AND v.channel = 'cash'
          AND v.direction = 'credit'
      ), 0) AS "cashInflow",
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow
          AND v.channel = 'cash'
          AND v.direction = 'debit'
      ), 0) AS "cashOutflow",
      COALESCE(SUM(
        CASE
          WHEN v.counts_as_cash_flow AND v.channel = 'cash' THEN
            CASE WHEN v.direction = 'credit' THEN v.amount ELSE -v.amount END
          ELSE 0
        END
      ), 0) AS "cashNet",

      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow
          AND v.channel = 'bank'
          AND v.direction = 'credit'
      ), 0) AS "bankInflow",
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow
          AND v.channel = 'bank'
          AND v.direction = 'debit'
      ), 0) AS "bankOutflow",
      COALESCE(SUM(
        CASE
          WHEN v.counts_as_cash_flow AND v.channel = 'bank' THEN
            CASE WHEN v.direction = 'credit' THEN v.amount ELSE -v.amount END
          ELSE 0
        END
      ), 0) AS "bankNet",

      COALESCE(SUM(v.amount) FILTER (
        WHERE v.status = 'completed' AND v.direction = 'credit'
      ), 0) AS "completedTotal",
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.status = 'pending' AND v.direction = 'credit'
      ), 0) AS "pendingTotal",
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.status IN ('refunded', 'partially_refunded')
          AND v.direction = 'credit'
      ), 0) AS "refundedTotal"
    ${FROM_SQL}
    WHERE ${where}
  `;
}

async function getTransactions({
  page = 1,
  limit = 10,
  sort_by = "date",
  sort_order = "desc",
  ...filters
} = {}) {
  page = Math.max(1, Number.parseInt(page, 10) || 1);
  limit = Math.max(1, Number.parseInt(limit, 10) || 10);

  const { where, values } = buildTransactionFilters(filters);

  const sortColumn = SORT_COLUMNS[sort_by] || SORT_COLUMNS.date;
  const sortDirection =
    String(sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";

  const offset = (page - 1) * limit;
  const limitParam = `$${values.length + 1}`;
  const offsetParam = `$${values.length + 2}`;

  const [transactionResult, countResult, summaryResult] = await Promise.all([
    query(
      `${SELECT_SQL}
       WHERE ${where}
       ORDER BY ${sortColumn} ${sortDirection} NULLS LAST,
                v.source_type ASC,
                v.source_row_id DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...values, limit, offset],
    ),

    query(
      `SELECT COUNT(*)::int AS total
       ${FROM_SQL}
       WHERE ${where}`,
      values,
    ),

    query(buildSummarySql(where), values),
  ]);

  const total = countResult.rows[0].total;

  return {
    transactions: transactionResult.rows,
    summary: summaryResult.rows[0],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    },
  };
}

async function getTransactionDetail({ sourceType, uuid, sourceRowId }) {
  const values = [sourceType, uuid];
  let rowCondition = "";

  if (sourceRowId) {
    values.push(sourceRowId);
    rowCondition = " AND v.source_row_id = $3";
  }

  const result = await query(
    `${SELECT_SQL}
     WHERE v.source_type = $1
       AND v.source_uuid = $2
       ${rowCondition}
     ORDER BY v.source_row_id ASC
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

async function getTransactionsForExport(filters = {}) {
  const { where, values } = buildTransactionFilters(filters);

  const result = await query(
    `${SELECT_SQL}
     WHERE ${where}
     ORDER BY v.transaction_date DESC NULLS LAST,
              v.source_type ASC,
              v.source_row_id DESC`,
    values,
  );

  return result.rows;
}

async function getFinancialTransactionByUuid(uuid) {
  const result = await pool.query(
    "SELECT * FROM financial_transactions WHERE uuid = $1 LIMIT 1",
    [uuid],
  );

  return result.rows[0] || null;
}

async function getAccountTransferByUuid(uuid) {
  const result = await pool.query(
    "SELECT * FROM account_transfers WHERE uuid = $1 LIMIT 1",
    [uuid],
  );

  return result.rows[0] || null;
}

async function createFinancialTransaction(data, createdBy, idempotencyKey) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingUuid = await findIdempotentResource(
      client,
      idempotencyKey,
      "financial_transaction.create",
    );

    if (existingUuid) {
      await client.query("ROLLBACK");
      const existing = await getFinancialTransactionByUuid(existingUuid);

      if (existing) {
        return { transaction: existing, idempotent_replay: true };
      }
    }

    const {
      transaction_type,
      account_id,
      party_id,
      category_id,
      amount,
      transaction_date,
      payment_method,
      reference_number,
      notes,
    } = data;

    if (!["income", "expense"].includes(transaction_type)) {
      throw createError("Transaction type must be income or expense.", 400);
    }

    if (!PAYMENT_METHODS.includes(payment_method)) {
      throw createError("A valid payment method is required.", 400);
    }

    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw createError("A valid transaction amount is required.", 400);
    }

    if (
      !Number.isSafeInteger(Number(category_id)) ||
      Number(category_id) <= 0
    ) {
      throw createError("A valid category is required.", 400);
    }

    const categoryResult = await client.query(
      `SELECT id
       FROM transaction_categories
       WHERE id = $1
         AND is_active = TRUE
         AND deleted_at IS NULL`,
      [category_id],
    );

    if (categoryResult.rowCount === 0) {
      throw createError(
        "The selected category was not found or is inactive.",
        400,
      );
    }

    let normalizedPartyId = null;

    if (party_id !== undefined && party_id !== null && party_id !== "") {
      if (!Number.isSafeInteger(Number(party_id)) || Number(party_id) <= 0) {
        throw createError("A valid party is required.", 400);
      }

      const partyResult = await client.query(
        "SELECT id FROM parties WHERE id = $1 AND deleted_at IS NULL",
        [party_id],
      );

      if (partyResult.rowCount === 0) {
        throw createError("The selected party was not found.", 400);
      }

      normalizedPartyId = Number(party_id);
    }

    const account = await resolveAccount(client, {
      paymentMethod: payment_method,
      accountId: account_id,
      lock: false,
    });

    if (transaction_type === "expense") {
      await assertSufficientBalance(client, {
        accountId: account.id,
        amount: parsedAmount,
      });
    }

    const entryDate = String(
      transaction_date || new Date().toISOString().slice(0, 10),
    ).slice(0, 10);

    const transactionNumber = await generateSequenceNumber(client, {
      source: "financial_transactions",
      prefix: "TXN",
      year: Number(entryDate.slice(0, 4)),
    });

    const result = await client.query(
      `INSERT INTO financial_transactions (
         transaction_number,
         transaction_type,
         account_id,
         party_id,
         category_id,
         amount,
         transaction_date,
         payment_method,
         status,
         reference_number,
         notes,
         created_by,
         updated_by
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date::timestamptz, $8, 'posted', $9, $10, $11, $11
       )
       RETURNING *`,
      [
        transactionNumber,
        transaction_type,
        account.id,
        normalizedPartyId,
        Number(category_id),
        parsedAmount.toFixed(2),
        entryDate,
        payment_method,
        reference_number?.trim() || null,
        notes?.trim() || null,
        createdBy || null,
      ],
    );

    await recordIdempotencyKey(
      client,
      idempotencyKey,
      "financial_transaction.create",
      result.rows[0].uuid,
    );

    await client.query("COMMIT");

    return { transaction: result.rows[0] };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Financial transaction rollback failed:", rollbackError);
    }

    if (isIdempotencyViolation(error) && idempotencyKey) {
      const existingResult = await pool.query(
        `SELECT f.*
         FROM idempotency_keys k
         INNER JOIN financial_transactions f ON f.uuid = k.resource_uuid
         WHERE k.key = $1
           AND k.scope = 'financial_transaction.create'
         LIMIT 1`,
        [idempotencyKey],
      );

      if (existingResult.rowCount > 0) {
        return {
          transaction: existingResult.rows[0],
          idempotent_replay: true,
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function createAccountTransfer(data, createdBy, idempotencyKey) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingUuid = await findIdempotentResource(
      client,
      idempotencyKey,
      "account_transfer.create",
    );

    if (existingUuid) {
      await client.query("ROLLBACK");
      const existing = await getAccountTransferByUuid(existingUuid);

      if (existing) {
        return { transfer: existing, idempotent_replay: true };
      }
    }

    const {
      from_account_id,
      to_account_id,
      amount,
      transfer_date,
      reference_number,
      notes,
    } = data;

    for (const [label, value] of Object.entries({
      from_account_id,
      to_account_id,
    })) {
      if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
        throw createError(`A valid ${label} is required.`, 400);
      }
    }

    if (Number(from_account_id) === Number(to_account_id)) {
      throw createError(
        "Source and destination accounts must be different.",
        400,
      );
    }

    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw createError("A valid transfer amount is required.", 400);
    }

    const accountsResult = await client.query(
      `SELECT id, uuid, account_name, account_type, is_active
       FROM accounts
       WHERE id = ANY($1::bigint[])
       ORDER BY id
       FOR UPDATE`,
      [[Number(from_account_id), Number(to_account_id)]],
    );

    if (accountsResult.rowCount !== 2) {
      throw createError("Both transfer accounts must exist.", 400);
    }

    const accountsById = new Map(
      accountsResult.rows.map((account) => [Number(account.id), account]),
    );
    const fromAccount = accountsById.get(Number(from_account_id));
    const toAccount = accountsById.get(Number(to_account_id));

    if (!fromAccount?.is_active || !toAccount?.is_active) {
      throw createError("Both transfer accounts must be active.", 400);
    }

    await assertSufficientBalance(client, {
      accountId: fromAccount.id,
      amount: parsedAmount,
    });

    const entryDate = String(
      transfer_date || new Date().toISOString().slice(0, 10),
    ).slice(0, 10);

    const transferNumber = await generateSequenceNumber(client, {
      source: "account_transfers",
      prefix: "TRF",
      year: Number(entryDate.slice(0, 4)),
    });

    const result = await client.query(
      `INSERT INTO account_transfers (
         transfer_number,
         from_account_id,
         to_account_id,
         amount,
         transfer_date,
         reference_number,
         notes,
         created_by
       )
       VALUES (
         $1, $2, $3, $4, $5::date::timestamptz, $6, $7, $8
       )
       RETURNING *`,
      [
        transferNumber,
        fromAccount.id,
        toAccount.id,
        parsedAmount.toFixed(2),
        entryDate,
        reference_number?.trim() || null,
        notes?.trim() || null,
        createdBy || null,
      ],
    );

    await recordIdempotencyKey(
      client,
      idempotencyKey,
      "account_transfer.create",
      result.rows[0].uuid,
    );

    await client.query("COMMIT");

    return { transfer: result.rows[0] };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Account transfer rollback failed:", rollbackError);
    }

    if (isIdempotencyViolation(error) && idempotencyKey) {
      const existingResult = await pool.query(
        `SELECT t.*
         FROM idempotency_keys k
         INNER JOIN account_transfers t ON t.uuid = k.resource_uuid
         WHERE k.key = $1
           AND k.scope = 'account_transfer.create'
         LIMIT 1`,
        [idempotencyKey],
      );

      if (existingResult.rowCount > 0) {
        return {
          transfer: existingResult.rows[0],
          idempotent_replay: true,
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getTransactions,
  getTransactionDetail,
  getTransactionsForExport,
  createFinancialTransaction,
  createAccountTransfer,
  getFinancialTransactionByUuid,
  getAccountTransferByUuid,
  SOURCE_TYPES,
  KINDS,
  DIRECTIONS,
  CHANNELS,
  PAYMENT_METHODS,
  STATUSES,
};
