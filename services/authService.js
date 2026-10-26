const { query } = require("../config/db");
const bcrypt = require("bcrypt");

async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await query(
    `SELECT id, uuid, full_name, email, password_hash, role, is_active
     FROM users
     WHERE LOWER(email) = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [normalizedEmail],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    return null;
  }

  await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
    user.id,
  ]);

  return {
    id: user.id,
    uuid: user.uuid,
    name: user.full_name,
    email: user.email,
    role: user.role,
  };
}

async function getUserById(userId) {
  const result = await query(
    `SELECT id, uuid, full_name, email, role, is_active
     FROM users
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return null;
  }

  return {
    id: user.id,
    uuid: user.uuid,
    name: user.full_name,
    email: user.email,
    role: user.role,
  };
}

async function resetPassword(userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);

  const result = await query(
    `UPDATE users
     SET password_hash = $1
     WHERE id = $2
       AND is_active = TRUE
       AND deleted_at IS NULL
     RETURNING id`,
    [passwordHash, userId],
  );

  return result.rowCount > 0;
}

module.exports = { login, getUserById, resetPassword };
