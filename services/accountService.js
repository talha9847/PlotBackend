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

module.exports = {
  createAccount,
  updateAccount,
  getAccountById,
  getAccounts,
};
