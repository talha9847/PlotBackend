const { query } = require("../config/db");

async function createAccount({ account_name, bank_name }) {
  const result = await query(
    `INSERT INTO accounts (
       account_name,
       bank_name
     )
     VALUES ($1, $2)
     RETURNING id, uuid, account_name, bank_name, created_at, updated_at`,
    [account_name.trim(), bank_name.trim()],
  );

  return result.rows[0];
}

async function updateAccount(accountId, { account_name, bank_name }) {
  const result = await query(
    `UPDATE accounts
     SET
       account_name = $1,
       bank_name = $2,
       updated_at = NOW()
     WHERE id = $3
     RETURNING id, uuid, account_name, bank_name, created_at, updated_at`,
    [account_name.trim(), bank_name.trim(), accountId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function getAccountById(accountId) {
  const result = await query(
    `SELECT
       id,
       uuid,
       account_name,
       bank_name,
       created_at,
       updated_at
     FROM accounts
     WHERE id = $1
     LIMIT 1`,
    [accountId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function getAccounts() {
  const result = await query(
    `SELECT
       id,
       uuid,
       account_name,
       bank_name,
       created_at,
       updated_at
     FROM accounts
     ORDER BY account_name ASC`,
  );

  return result.rows;
}

async function getTransactionsByAccount({
  accountUuid,
  page = 1,
  limit = 10,
  search = "",
}) {
  const offset = (page - 1) * limit;
  const searchTerm = search.trim();

  const accountResult = await query(
    `
      SELECT id, uuid, account_name, bank_name
      FROM accounts
      WHERE uuid = $1
      LIMIT 1
    `,
    [accountUuid],
  );

  if (!accountResult.rows.length) {
    const error = new Error("Account not found");
    error.statusCode = 404;
    throw error;
  }

  const account = accountResult.rows[0];

  const joins = `
  FROM payments pay
  LEFT JOIN customers c
    ON c.id = pay.customer_id
  LEFT JOIN leads l
    ON l.id = c.lead_id
  LEFT JOIN bookings b
    ON b.id = pay.booking_id
  LEFT JOIN plots pl
    ON pl.id = b.plot_id
  LEFT JOIN users u
    ON u.id = pay.received_by
`;

  const whereClause = `
  WHERE pay.account_id = $1
    AND (
      $2::text = ''
      OR pay.payment_number ILIKE '%' || $2 || '%'
      OR COALESCE(l.name, '') ILIKE '%' || $2 || '%'
      OR COALESCE(l.phone, '') ILIKE '%' || $2 || '%'
      OR COALESCE(b.booking_number, '') ILIKE '%' || $2 || '%'
      OR COALESCE(pl.plot_number, '') ILIKE '%' || $2 || '%'
      OR pay.payment_method ILIKE '%' || $2 || '%'
    )
`;

  const values = [account.id, searchTerm];

  const [transactionsResult, summaryResult] = await Promise.all([
    query(
      `
        SELECT
          pay.id AS payment_id,
          pay.uuid AS payment_uuid,
          pay.payment_number,
          pay.account_id,
          pay.booking_id,
          pay.customer_id,
          pay.installment_id,
          pay.payment_method,
          pay.amount,
          pay.payment_date,
          pay.received_by,
          pay.status AS payment_status,
          pay.notes,
          l.name AS customer_name,
          l.phone AS customer_phone,
          b.booking_number,
          pl.plot_number,
          u.full_name AS received_by_name
        ${joins}
        ${whereClause}
        ORDER BY pay.payment_date DESC, pay.id DESC
        LIMIT $3 OFFSET $4
      `,
      [...values, limit, offset],
    ),

    query(
      `
        SELECT
          COUNT(*)::integer AS total_transactions,
          COALESCE(
            SUM(pay.amount) FILTER (
              WHERE pay.status = 'completed'
            ), 0
          ) AS total_completed_amount,
          COALESCE(
            SUM(pay.amount) FILTER (
              WHERE pay.status = 'pending'
            ), 0
          ) AS total_pending_amount
        ${joins}
        ${whereClause}
      `,
      values,
    ),
  ]);

  const summary = summaryResult.rows[0];
  const total = summary.total_transactions;
  const totalPages = Math.ceil(total / limit);

  return {
    account,
    transactions: transactionsResult.rows,
    summary: {
      total_transactions: total,
      total_completed_amount: summary.total_completed_amount,
      total_pending_amount: summary.total_pending_amount,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

module.exports = {
  createAccount,
  updateAccount,
  getAccountById,
  getAccounts,
  getTransactionsByAccount,
};
