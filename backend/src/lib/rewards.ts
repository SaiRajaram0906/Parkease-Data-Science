import { and, eq, inArray, ne } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

/**
 * Driver rewards: one free booking for every ten paid bookings.
 *
 * Nothing is stored separately; the figures are always recomputed from the
 * driver's booking history, so they cannot drift out of step with it.
 *   - a booking counts once it is confirmed or completed (cancelled ones do not)
 *   - a booking paid with a reward does not count towards the next reward
 *   - a reward is used up by a free booking, and comes back if that booking
 *     is cancelled
 */
export const BOOKINGS_PER_REWARD = 10;

export interface RewardSummary {
  bookingsPerReward: number;
  qualifyingBookings: number;
  earned: number;
  redeemed: number;
  available: number;
  /** Bookings counted towards the next reward (0 to 9). */
  progress: number;
  /** Bookings still needed for the next reward. */
  remaining: number;
}

export async function rewardSummary(userId: number): Promise<RewardSummary> {
  const paid = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.userId, userId),
        eq(bookingsTable.isReward, false),
        inArray(bookingsTable.status, ["confirmed", "completed"]),
      ),
    );
  const free = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.userId, userId),
        eq(bookingsTable.isReward, true),
        ne(bookingsTable.status, "cancelled"),
      ),
    );

  const qualifyingBookings = paid.length;
  const earned = Math.floor(qualifyingBookings / BOOKINGS_PER_REWARD);
  const redeemed = free.length;
  const progress = qualifyingBookings % BOOKINGS_PER_REWARD;
  return {
    bookingsPerReward: BOOKINGS_PER_REWARD,
    qualifyingBookings,
    earned,
    redeemed,
    available: Math.max(0, earned - redeemed),
    progress,
    remaining: BOOKINGS_PER_REWARD - progress,
  };
}
