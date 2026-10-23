import { db, bookingsTable, spotsTable } from "@workspace/db";
import { and, eq, lt, lte } from "drizzle-orm";
import { logger } from "./logger";
import { sendBookingNotifications } from "./notifications";

/**
 * Updates status of expired bookings (confirmed -> completed)
 * and increments available slots for the associated spots.
 */
export async function updateBookingStatuses() {
  const now = new Date();

  try {
    // Find bookings that are 'confirmed' but have expired
    const expiredBookings = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "confirmed"),
          lte(bookingsTable.endTime, now)
        )
      );

    if (expiredBookings.length === 0) return;

    logger.info({ count: expiredBookings.length }, "Found expired bookings to update");

    for (const booking of expiredBookings) {
      try {
        await db.transaction(async (tx) => {
          // Double check the status hasn't changed in the meantime
          const [current] = await tx
            .select()
            .from(bookingsTable)
            .where(eq(bookingsTable.id, booking.id));

          if (!current || current.status !== "confirmed") return;

          // Update booking status
          await tx
            .update(bookingsTable)
            .set({ status: "completed" })
            .where(eq(bookingsTable.id, booking.id));

          // Increment available slots for the spot
          const [spot] = await tx
            .select()
            .from(spotsTable)
            .where(eq(spotsTable.id, booking.spotId));

          if (spot && spot.availableSlots < spot.totalSlots) {
            await tx
              .update(spotsTable)
              .set({ availableSlots: spot.availableSlots + 1 })
              .where(eq(spotsTable.id, booking.spotId));
          }
        });
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, "Failed to update expired booking");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in updateBookingStatuses background task");
  }
}

/**
 * Releases slots held for payments that were never finished (15 minutes).
 */
export async function releaseUnpaidBookings() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  try {
    const released = await db
      .update(bookingsTable)
      .set({ status: "cancelled", paymentStatus: "failed", refundError: "Payment was not completed within 15 minutes." })
      .where(and(eq(bookingsTable.status, "pending"), eq(bookingsTable.paymentStatus, "pending"), lt(bookingsTable.createdAt, cutoff)))
      .returning({ id: bookingsTable.id });
    if (released.length) logger.info({ count: released.length }, "Released unpaid bookings");
  } catch (err) {
    logger.error({ err }, "Could not release unpaid bookings");
  }
}

/**
 * Initializes the background task to run periodically.
 */
export function startBackgroundTasks() {
  const ONE_MINUTE = 60 * 1000;
  
  // Messages first ("started" / "ended"), then the status change.
  const run = async (label: string) => {
    await releaseUnpaidBookings();
    await sendBookingNotifications();
    await updateBookingStatuses().catch((err) => {
      logger.error({ err }, `${label} booking status update failed`);
    });
  };

  // Run once on startup
  void run("Initial");

  // Schedule periodic runs
  setInterval(() => void run("Periodic"), ONE_MINUTE);
  
  logger.info("Background tasks started");
}
