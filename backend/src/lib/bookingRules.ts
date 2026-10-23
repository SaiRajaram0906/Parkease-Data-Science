import { randomBytes } from "node:crypto";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db, bookingsTable, spotsTable, type Spot, type User } from "@workspace/db";
import { CreateBookingBody } from "@workspace/api-zod";
import { rewardSummary } from "./rewards";

/**
 * The checks every new booking goes through, whether it is paid through
 * Razorpay, in demo mode, or with a free reward. Returns either an error to
 * send back, or everything needed to store the booking.
 */

// Letters and digits that cannot be confused with each other (no 0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newVerifyCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `PE-${code}`;
}

export const slotLabel = (n: number): string => `P-${String(n).padStart(3, "0")}`;

export type PreparedBooking =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      spot: Spot;
      useReward: boolean;
      amount: number;
      values: typeof bookingsTable.$inferInsert;
    };

export async function prepareBooking(body: unknown, user: User): Promise<PreparedBooking> {
  const parsed = CreateBookingBody.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.message };

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, parsed.data.spotId));
  if (!spot) return { ok: false, status: 404, error: "Spot not found" };
  if (!spot.isActive) return { ok: false, status: 400, error: "This spot is not accepting bookings right now." };

  const start = new Date(parsed.data.startTime);
  const end = new Date(parsed.data.endTime);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, status: 400, error: "The end time must be after the start time." };
  }

  // A booking overlaps if (existing start < requested end) and (existing end > requested start).
  // Bookings waiting for payment count too, so the slot is held while the driver pays.
  const overlapping = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.spotId, spot.id),
        ne(bookingsTable.status, "cancelled"),
        lt(bookingsTable.startTime, end),
        gt(bookingsTable.endTime, start),
      ),
    );
  if (overlapping.length >= spot.totalSlots) {
    return { ok: false, status: 400, error: "The chosen time slot is already booked. Please select a different time." };
  }

  const useReward = (body as { useReward?: unknown })?.useReward === true;
  if (useReward && (await rewardSummary(user.id)).available < 1) {
    return { ok: false, status: 400, error: "You do not have a free parking reward to use yet." };
  }

  // The price is worked out here, never taken from the browser.
  const amount = useReward ? 0 : Math.round(Number(spot.pricePerHour) * hours * 100) / 100;

  // Large facility: keep the lowest-numbered slot that is free for this time.
  let keptSlot: string | null = null;
  if (spot.isLargeFacility) {
    const taken = new Set(overlapping.map((b) => b.slotLabel));
    for (let n = 1; n <= spot.totalSlots; n += 1) {
      if (!taken.has(slotLabel(n))) {
        keptSlot = slotLabel(n);
        break;
      }
    }
  }

  return {
    ok: true,
    spot,
    useReward,
    amount,
    values: {
      ...parsed.data,
      userId: user.id, // a booking always belongs to the signed-in user
      userEmail: user.email,
      startTime: start,
      endTime: end,
      durationHours: hours.toFixed(2),
      totalAmount: amount.toFixed(2),
      spotName: spot.name,
      isReward: useReward,
      verifyCode: newVerifyCode(),
      slotLabel: keptSlot,
    },
  };
}
