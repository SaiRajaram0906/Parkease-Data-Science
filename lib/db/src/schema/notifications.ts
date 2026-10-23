import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Messages sent to a user about a booking (parking started, parking ended).
 * Each row is shown in the app and records what happened to the email.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  bookingId: integer("booking_id"),
  kind: text("kind").notNull(), // "booking_started" | "booking_ended" | "test"
  toEmail: text("to_email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // "sent" | "not_configured" | "skipped_demo" | "failed"
  emailStatus: text("email_status").notNull(),
  emailError: text("email_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
