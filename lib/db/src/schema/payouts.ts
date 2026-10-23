import { pgTable, text, serial, timestamp, integer, decimal } from "drizzle-orm/pg-core";

/**
 * Money paid out to a parking owner (their earnings minus the platform
 * commission). Recorded by an admin after the transfer is made.
 */
export const payoutsTable = pgTable("payouts", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reference: text("reference").notNull(), // UPI / bank transaction reference
  note: text("note"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payout = typeof payoutsTable.$inferSelect;
