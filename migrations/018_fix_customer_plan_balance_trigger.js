"use strict";

async function up(client) {
  // Only apply the one-time booking-amount correction when the trigger that is
  // currently installed still uses the old formula. This prevents a second
  // correction on databases where the function was already patched manually.
  const existingFunction = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_customer_plan_balance'
      AND n.nspname = 'public'
    LIMIT 1
  `);

  const existingDefinition =
    existingFunction.rows[0]?.definition?.toLowerCase() || "";

  const functionExists = existingDefinition.length > 0;
  const functionAlreadyAccountsForBooking =
    existingDefinition.includes("booking_amount");
  const shouldCorrectExistingPlans =
    functionExists && !functionAlreadyAccountsForBooking;

  await client.query(`
    CREATE OR REPLACE FUNCTION set_customer_plan_balance()
    RETURNS TRIGGER AS $$
    DECLARE
      v_total_amount NUMERIC(14,2);
      v_booking_amount NUMERIC(14,2);
      v_down_payment_delta NUMERIC(14,2);
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.booking_id <> OLD.booking_id THEN
        RAISE EXCEPTION 'Plan booking_id cannot be changed';
      END IF;

      SELECT total_amount, booking_amount
      INTO v_total_amount, v_booking_amount
      FROM bookings
      WHERE id = NEW.booking_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking % does not exist', NEW.booking_id;
      END IF;

      IF (v_booking_amount + NEW.down_payment) > v_total_amount THEN
        RAISE EXCEPTION
          'Booking token plus down payment (%) exceeds booking total (%)',
          (v_booking_amount + NEW.down_payment), v_total_amount;
      END IF;

      IF TG_OP = 'INSERT' THEN
        NEW.remaining_balance :=
          v_total_amount - v_booking_amount - NEW.down_payment;
      ELSIF TG_OP = 'UPDATE' THEN
        -- Adjust the outstanding balance by the change in down payment. Do not
        -- rebuild it from the booking total, because that would erase payments
        -- already collected against the plan.
        IF NEW.down_payment <> OLD.down_payment THEN
          v_down_payment_delta := NEW.down_payment - OLD.down_payment;

          IF v_down_payment_delta > OLD.remaining_balance THEN
            RAISE EXCEPTION
              'Down payment increase (%) exceeds the outstanding plan balance (%)',
              v_down_payment_delta, OLD.remaining_balance;
          END IF;

          NEW.remaining_balance :=
            OLD.remaining_balance - v_down_payment_delta;
        END IF;
      END IF;

      NEW.updated_at := NOW();

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_customer_plan_balance ON customer_plans;

    CREATE TRIGGER trg_customer_plan_balance
      BEFORE INSERT OR UPDATE OF
        booking_id, down_payment, remaining_balance
      ON customer_plans
      FOR EACH ROW
      EXECUTE FUNCTION set_customer_plan_balance();
  `);

  if (shouldCorrectExistingPlans) {
    await client.query(`
      UPDATE customer_plans cp
      SET remaining_balance = GREATEST(
        cp.remaining_balance - b.booking_amount,
        0
      ),
      updated_at = NOW()
      FROM bookings b
      WHERE b.id = cp.booking_id
        AND b.booking_amount > 0;
    `);
  }
}

module.exports = { up };
