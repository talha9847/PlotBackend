const fs = require("fs");
const path = require("path");
const { pool, getClient } = require("./config/db");

const migrationsPath = path.join(__dirname, "migrations");
console.log(migrationsPath)
async function migrate() {
  const client = await getClient();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log("✅ Database connected");

    const files = fs
      .readdirSync(migrationsPath)
      .filter((file) => file.endsWith(".js"))
      .sort();

    for (const file of files) {
      const result = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [file],
      );

      if (result.rowCount > 0) {
        console.log(`⏭️ Skipping: ${file}`);
        continue;
      }

      const migration = require(path.join(migrationsPath, file));

      console.log(`Running migration: ${file}`);

      await client.query("BEGIN");

      try {
        await migration.up(client);

        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );

        await client.query("COMMIT");
        console.log(`✅ Completed: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("✅ All migrations completed");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function seed() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected");

    const userSeeder = require("./seeders/userSeeder");
    await userSeeder(pool);

    console.log("✅ Seeding completed");
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const command = process.argv[2];

if (command === "migrate") {
  migrate();
} else if (command === "seed") {
  seed();
} else {
  console.error("Usage: node src/scripts/db.js migrate|seed");
  process.exitCode = 1;
}
