const { query } = require("../config/db");
const transactionService = require("./transactionService");

const ACCOUNT_FIELDS = `
  id,
  uuid,
  account_name,
  bank_name,
  account_type,
  opening_balance,
  is_active,
  created_at,
  updated_at
`;

async function createAccount({ account_name, bank_name, opening_balance = 0 }) {
  const result = await query(
    `INSERT INTO accounts (
       account_name,
       bank_name,
       account_type,
       opening_balance
     )
     VALUES ($1, $2, 'bank', $3)
     RETURNING ${ACCOUNT_FIELDS}`,
    [account_name.trim(), bank_name.trim(), opening_balance],
  );

  return result.rows[0];
}

async function updateAccount(
  accountId,
  { account_name, bank_name, opening_balance },
) {
  const existingResult = await query(
    `SELECT account_type, opening_balance
     FROM accounts
     WHERE id = $1
     LIMIT 1`,
    [accountId],
  );

  if (existingResult.rowCount === 0) {
    return null;
  }

  const existing = existingResult.rows[0];
  const nextBankName =
    existing.account_type === "cash" ? null : bank_name.trim();
  const nextOpeningBalance =
    opening_balance === undefined
      ? existing.opening_balance
      : opening_balance;

  const result = await query(
    `UPDATE accounts
     SET
       account_name = $1,
       bank_name = $2,
       opening_balance = $3,
       updated_at = NOW()
     WHERE id = $4
     RETURNING ${ACCOUNT_FIELDS}`,
    [account_name.trim(), nextBankName, nextOpeningBalance, accountId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function getAccountById(accountId) {
  const result = await query(
    `SELECT ${ACCOUNT_FIELDS}
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
    `SELECT ${ACCOUNT_FIELDS}
     FROM accounts
     ORDER BY
       CASE WHEN account_type = 'cash' THEN 0 ELSE 1 END,
       account_name ASC`,
  );

  return result.rows;
}

async function getAccountBalances() {
  const result = await query(`
    SELECT
      a.id,
      a.uuid,
      a.account_name,
      a.bank_name,
      a.account_type,
      a.opening_balance,
      a.is_active,
      a.opening_balance
        + COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_balance AND v.direction = 'credit'
          ), 0)
        - COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_balance AND v.direction = 'debit'
          ), 0) AS current_balance,
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow AND v.direction = 'credit'
      ), 0) AS total_inflow,
      COALESCE(SUM(v.amount) FILTER (
        WHERE v.counts_as_cash_flow AND v.direction = 'debit'
      ), 0) AS total_outflow
    FROM accounts a
    LEFT JOIN v_unified_transactions v
      ON v.account_id = a.id
    GROUP BY a.id
    ORDER BY
      CASE WHEN a.account_type = 'cash' THEN 0 ELSE 1 END,
      a.account_name ASC
  `);

  const accounts = result.rows.map((account) => {
    const inflow = Number(account.total_inflow ?? 0);
    const outflow = Number(account.total_outflow ?? 0);

    return {
      ...account,
      opening_balance: Number(account.opening_balance ?? 0),
      current_balance: Number(account.current_balance ?? 0),
      total_inflow: inflow,
      total_outflow: outflow,
      net_flow: Number((inflow - outflow).toFixed(2)),
    };
  });

  const totals = accounts.reduce(
    (accumulator, account) => {
      const bucket = account.account_type === "cash" ? "cash" : "bank";

      accumulator[bucket].balance += account.current_balance;
      accumulator[bucket].inflow += account.total_inflow;
      accumulator[bucket].outflow += account.total_outflow;
      accumulator[bucket].accountCount += 1;

      return accumulator;
    },
    {
      cash: { balance: 0, inflow: 0, outflow: 0, accountCount: 0 },
      bank: { balance: 0, inflow: 0, outflow: 0, accountCount: 0 },
    },
  );

  for (const bucket of [totals.cash, totals.bank]) {
    bucket.balance = Number(bucket.balance.toFixed(2));
    bucket.inflow = Number(bucket.inflow.toFixed(2));
    bucket.outflow = Number(bucket.outflow.toFixed(2));
    bucket.net = Number((bucket.inflow - bucket.outflow).toFixed(2));
  }

  totals.combined = {
    balance: Number((totals.cash.balance + totals.bank.balance).toFixed(2)),
    inflow: Number((totals.cash.inflow + totals.bank.inflow).toFixed(2)),
    outflow: Number((totals.cash.outflow + totals.bank.outflow).toFixed(2)),
    net: Number((totals.cash.net + totals.bank.net).toFixed(2)),
    accountCount: accounts.length,
  };

  return { accounts, totals };
}

async function getTransactionsByAccount({
  accountUuid,
  page = 1,
  limit = 10,
  search = "",
  kind,
  direction,
  start_date,
  end_date,
}) {
  const accountResult = await query(
    `
      SELECT
        id,
        uuid,
        account_name,
        bank_name,
        account_type,
        opening_balance,
        is_active
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

  const accountRow = accountResult.rows[0];

  const [transactionResult, balanceResult] = await Promise.all([
    transactionService.getTransactions({
      account_id: accountRow.id,
      search,
      kind,
      direction,
      start_date,
      end_date,
      page,
      limit,
      sort_by: "date",
      sort_order: "desc",
    }),

    query(
      `
        SELECT
          COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_balance AND v.direction = 'credit'
          ), 0) AS total_credited,
          COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_balance AND v.direction = 'debit'
          ), 0) AS total_debited,
          COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_cash_flow AND v.direction = 'credit'
          ), 0) AS total_inflow,
          COALESCE(SUM(v.amount) FILTER (
            WHERE v.counts_as_cash_flow AND v.direction = 'debit'
          ), 0) AS total_outflow
        FROM v_unified_transactions v
        WHERE v.account_id = $1
      `,
      [accountRow.id],
    ),
  ]);

  const balance = balanceResult.rows[0];
  const openingBalance = Number(accountRow.opening_balance ?? 0);
  const currentBalance = Number(
    (
      openingBalance +
      Number(balance.total_credited ?? 0) -
      Number(balance.total_debited ?? 0)
    ).toFixed(2),
  );
  const totalInflow = Number(balance.total_inflow ?? 0);
  const totalOutflow = Number(balance.total_outflow ?? 0);

  const account = {
    ...accountRow,
    opening_balance: openingBalance,
    current_balance: currentBalance,
    total_inflow: totalInflow,
    total_outflow: totalOutflow,
    net_flow: Number((totalInflow - totalOutflow).toFixed(2)),
  };

  const summary = transactionResult.summary;

  return {
    account,
    transactions: transactionResult.transactions,
    summary: {
      ...summary,
      total_transactions: summary.totalTransactions,
      total_completed_amount: summary.completedTotal,
      total_pending_amount: summary.pendingTotal,
    },
    pagination: transactionResult.pagination,
  };
}

module.exports = {
  createAccount,
  updateAccount,
  getAccountById,
  getAccounts,
  getAccountBalances,
  getTransactionsByAccount,
};
