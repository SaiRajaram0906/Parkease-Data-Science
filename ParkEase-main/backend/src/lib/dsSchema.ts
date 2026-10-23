import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Adds the optional columns introduced after the original schema: the two
 * Data Science link columns and the password hash.
 *
 * `ADD COLUMN IF NOT EXISTS` only ever adds a nullable column, so it cannot
 * change or remove existing ParkEase data, and running it again is harmless.
 * It does the same job as `pnpm --filter @workspace/db run push`, without
 * needing drizzle-kit to work on the developer's machine.
 */
export async function ensureDataScienceColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS dataset_user_id text`);
    await db.execute(sql`ALTER TABLE spots ADD COLUMN IF NOT EXISTS dataset_slot_id text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`);
  } catch (err) {
    logger.error({ err }, "Could not add the Data Science link columns");
    throw err;
  }
}
