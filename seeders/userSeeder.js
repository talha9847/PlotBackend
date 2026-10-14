const bcrypt = require("bcrypt");

async function userSeeder(pool) {
  const name = "Admin";
  const email = "admin@gmail.com";
  const password = "Admin@432";

  // Hash password before storing it
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `
      INSERT INTO users (
        full_name,
        email,
        password_hash,
        role,
        is_active
      )
      VALUES ($1, $2, $3, 'admin', TRUE)
      ON CONFLICT (LOWER(email)) DO NOTHING
    `,
    [name, email, passwordHash],
  );

  console.log("✅ Admin seeding completed");
}

module.exports = userSeeder;
