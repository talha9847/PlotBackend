async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS installment_reschedules (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      installment_id BIGINT NOT NULL
        REFERENCES installments(id) ON DELETE RESTRICT,
      old_due_date DATE NOT NULL,
      new_due_date DATE NOT NULL,
      reason TEXT NOT NULL,
      approved_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
      created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { up };
