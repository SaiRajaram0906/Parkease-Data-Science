import { pgTable, text, serial, timestamp, integer, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const spotsTable = pgTable("spots", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id"),
  name: text("name").notNull(),
  description: text("description"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  latitude: text("latitude"),
  longitude: text("longitude"),
  pricePerHour: decimal("price_per_hour", { precision: 10, scale: 2 }).notNull(),
  pricePerDay: decimal("price_per_day", { precision: 10, scale: 2 }),
  vehicleType: text("vehicle_type").notNull().default("car"),
  totalSlots: integer("total_slots").notNull().default(1),
  availableSlots: integer("available_slots").notNull().default(1),
  amenities: text("amenities"),
  imageUrl: text("image_url"),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalReviews: integer("total_reviews").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Data Science layer: optional link to a listing of the synthetic
  // historical dataset (for example "SLOT0179"). Null for ordinary spots.
  datasetSlotId: text("dataset_slot_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSpotSchema = createInsertSchema(spotsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpot = z.infer<typeof insertSpotSchema>;
export type Spot = typeof spotsTable.$inferSelect;
