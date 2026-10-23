import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, bookingsTable, notificationsTable, spotsTable, usersTable, type Booking } from "@workspace/db";
import { logger } from "./logger";
import { sendMail } from "./mailer";

/**
 * "Parking started" and "parking ended" messages.
 *
 * Once a minute the server looks for bookings whose start or end time has
 * just passed and that have not had their message yet. Each message is saved
 * in the notifications table (shown in the app) and emailed to the address
 * the driver registered with.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function whenText(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function htmlBody(title: string, lines: string[]): string {
  const rows = lines.map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join("");
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1a1a2e">` +
    `<h2 style="margin:0 0 14px">${escapeHtml(title)}</h2>${rows}` +
    `<p style="margin:18px 0 0;color:#666;font-size:12px">ParkEase booking update</p></div>`
  );
}

async function recipientOf(booking: Booking): Promise<{ id: number | null; name: string; email: string }> {
  if (booking.userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, booking.userId));
    if (user) return { id: user.id, name: user.name, email: user.email };
  }
  return { id: booking.userId, name: "there", email: booking.userEmail ?? "" };
}

async function notify(booking: Booking, kind: "booking_started" | "booking_ended"): Promise<void> {
  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, booking.spotId));
  const person = await recipientOf(booking);
  const place = booking.spotName ?? spot?.name ?? "your parking spot";
  const address = spot ? `${spot.address}, ${spot.city}` : "";
  const slot = booking.slotLabel ? `Your slot: ${booking.slotLabel}.` : "";

  const started = kind === "booking_started";
  const subject = started
    ? `Your parking spot is ready: ${place}`
    : `Your parking time has ended: ${place}`;
  const lines = started
    ? [
        `Hi ${person.name},`,
        `Your parking time at ${place} has started. The spot is ready for vehicle ${booking.vehicleNumber}.`,
        address ? `Address: ${address}` : "",
        slot,
        `Booked from ${whenText(booking.startTime)} to ${whenText(booking.endTime)} (booking #${booking.id}).`,
        spot?.isLargeFacility ? "Show the QR code of this booking at the entrance." : "",
      ]
    : [
        `Hi ${person.name},`,
        `Your parking time at ${place} ended at ${whenText(booking.endTime)} (booking #${booking.id}).`,
        "Please move your vehicle if it is still there, so the next driver can park.",
        "Thank you for parking with ParkEase.",
      ];
  const text = lines.filter(Boolean);

  const result = await sendMail({
    to: person.email,
    subject,
    text: text.join("\n\n"),
    html: htmlBody(started ? "Your parking spot is ready" : "Your parking time has ended", text),
  });

  await db.insert(notificationsTable).values({
    userId: person.id,
    bookingId: booking.id,
    kind,
    toEmail: person.email || null,
    subject,
    body: text.slice(1).join("\n"),
    emailStatus: result.status,
    emailError: result.error ?? null,
  });
  logger.info({ bookingId: booking.id, kind, email: result.status }, "Booking message created");
}

export async function sendBookingNotifications(): Promise<void> {
  const now = new Date();
  try {
    // Parking has started and is still running.
    const starting = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "confirmed"),
          lte(bookingsTable.startTime, now),
          gt(bookingsTable.endTime, now),
          isNull(bookingsTable.startNotifiedAt),
        ),
      );
    for (const booking of starting) {
      // Claim the booking first, so two runs can never send the same message.
      const claimed = await db
        .update(bookingsTable)
        .set({ startNotifiedAt: now })
        .where(and(eq(bookingsTable.id, booking.id), isNull(bookingsTable.startNotifiedAt)))
        .returning();
      if (claimed.length) await notify(booking, "booking_started");
    }

    // Parking has ended.
    const ending = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          inArray(bookingsTable.status, ["confirmed", "completed"]),
          lte(bookingsTable.endTime, now),
          isNull(bookingsTable.endNotifiedAt),
        ),
      );
    for (const booking of ending) {
      const claimed = await db
        .update(bookingsTable)
        .set({ endNotifiedAt: now })
        .where(and(eq(bookingsTable.id, booking.id), isNull(bookingsTable.endNotifiedAt)))
        .returning();
      // Bookings that ended long ago (before this feature, or while the
      // server was off for days) are marked without sending a late message.
      if (claimed.length && now.getTime() - booking.endTime.getTime() <= DAY_MS) {
        await notify(booking, "booking_ended");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error while sending booking messages");
  }
}
