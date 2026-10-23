import { pgTable, text, serial, timestamp, integer, decimal, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  spotId: integer("spot_id").notNull(),
  userId: integer("user_id"),
  spotName: text("spot_name"),
  userEmail: text("user_email"),
  vehicleNumber: text("vehicle_number").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  durationHours: decimal("duration_hours", { precision: 6, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentId: text("payment_id"),
  notes: text("notes"),
  // Entry pass: the code inside the QR code, checked by the spot owner.
  verifyCode: text("verify_code"),
  // Numbered slot kept for this booking (large facilities only).
  slotLabel: text("slot_label"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  // True when the booking was paid with a free-parking reward.
  isReward: boolean("is_reward").notNull().default(false),
  // When the "parking has started" / "parking has ended" messages were sent.
  startNotifiedAt: timestamp("start_notified_at", { withTimezone: true }),
  endNotifiedAt: timestamp("end_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
