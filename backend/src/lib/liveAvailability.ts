import { and, count, gt, inArray, lt, ne } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

/**
 * Real availability of spots in a time window, from live bookings.
 *
 * A space is taken by every non-cancelled booking that overlaps the window.
 * This is the same overlap rule the booking endpoint uses to refuse a full
 * spot, so "free spaces" here always agrees with what can actually be booked.
 */
export async function bookedCounts(
  windowStart: Date,
  windowEnd: Date,
  spotIds?: number[],
): Promise<Map<number, number>> {
  if (spotIds && spotIds.length === 0) return new Map();
  const conditions = [
    ne(bookingsTable.status, "cancelled"),
    lt(bookingsTable.startTime, windowEnd),
    gt(bookingsTable.endTime, windowStart),
  ];
  if (spotIds) conditions.push(inArray(bookingsTable.spotId, spotIds));

  const rows = await db
    .select({ spotId: bookingsTable.spotId, booked: count(bookingsTable.id) })
    .from(bookingsTable)
    .where(and(...conditions))
    .groupBy(bookingsTable.spotId);

  return new Map(rows.map((row) => [row.spotId, Number(row.booked)]));
}

export function freeSpaces(totalSlots: number, booked: number | undefined): number {
  return Math.max(0, totalSlots - (booked ?? 0));
}

/** Free spaces right now for the given spots (window: now to one minute ahead). */
export async function withLiveAvailability<T extends { id: number; totalSlots: number }>(
  spots: T[],
): Promise<(T & { availableSlots: number })[]> {
  if (spots.length === 0) return [];
  const now = new Date();
  const counts = await bookedCounts(now, new Date(now.getTime() + 60_000), spots.map((s) => s.id));
  return spots.map((spot) => ({
    ...spot,
    availableSlots: freeSpaces(spot.totalSlots, counts.get(spot.id)),
  }));
}
