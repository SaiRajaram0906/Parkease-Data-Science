import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Adds the columns and the table introduced after the original schema:
 * the Data Science links, the password hash, large facilities with QR entry
 * passes, rewards, the start/end messages, payments and owner payouts.
 *
 * Every statement uses IF NOT EXISTS and only adds things (a nullable column,
 * a column with a default, or a new table), so it cannot change or remove
 * existing ParkEase data, and running it again is harmless. It does the same
 * job as `pnpm --filter @workspace/db run push`, without needing drizzle-kit
 * to work on the developer's machine.
 */
export async function ensureDataScienceColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS dataset_user_id text`);
    await db.execute(sql`ALTER TABLE spots ADD COLUMN IF NOT EXISTS dataset_slot_id text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`);

    await db.execute(sql`ALTER TABLE spots ADD COLUMN IF NOT EXISTS is_large_facility boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE spots ADD COLUMN IF NOT EXISTS directions_query text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verify_code text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slot_label text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at timestamptz`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_reward boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_notified_at timestamptz`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_notified_at timestamptz`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_mode text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_order_id text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_id text`);
    await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_error text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_upi text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_name text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payouts (
        id serial PRIMARY KEY,
        owner_id integer NOT NULL,
        amount numeric(10, 2) NOT NULL,
        reference text NOT NULL,
        note text,
        created_by integer,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id serial PRIMARY KEY,
        user_id integer,
        booking_id integer,
        kind text NOT NULL,
        to_email text,
        subject text NOT NULL,
        body text NOT NULL,
        email_status text NOT NULL,
        email_error text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  } catch (err) {
    logger.error({ err }, "Could not add the new ParkEase columns");
    throw err;
  }
}
