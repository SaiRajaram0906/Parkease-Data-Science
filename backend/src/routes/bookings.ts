import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, bookingsTable, spotsTable, usersTable, type Booking } from "@workspace/db";
import { updateBookingStatuses } from "../lib/tasks";
import {
  ListBookingsQueryParams,
  GetBookingParams,
  UpdateBookingParams,
  UpdateBookingBody,
} from "@workspace/api-zod";
import { currentUser, isAdmin, requireAuth, requireRole } from "../lib/auth";
import { prepareBooking } from "../lib/bookingRules";
import { paymentSettings, refundPayment, PaymentError } from "../lib/payments";
import { logger } from "../lib/logger";

/**
 * Bookings. Every route needs a signed-in user.
 *
 * Who may book: drivers (and admins). Owner accounts list parking; they do
 * not book it.
 * Who may see or change a booking:
 *   the driver who made it, the owner of the booked spot, or an admin.
 * The driver may only cancel; the owner and admins may also confirm or
 * complete it.
 *
 * Entry pass: every booking gets a code. At a large facility the driver shows
 * it as a QR code and the owner checks it with
 *   GET  /bookings/verify/:code            is this pass valid right now?
 *   POST /bookings/verify/:code/check-in   let the vehicle in
 */
const router: IRouter = Router();
router.use("/bookings", requireAuth);

/** A vehicle may enter from 15 minutes before the start until the end. */
const EARLY_ENTRY_MS = 15 * 60 * 1000;

type PassState = "valid" | "checked_in" | "early" | "expired" | "cancelled";

function passState(booking: Booking, now = new Date()): { state: PassState; message: string } {
  if (booking.status === "cancelled") return { state: "cancelled", message: "This booking was cancelled. Do not allow entry." };
  if (now.getTime() >= booking.endTime.getTime()) return { state: "expired", message: "The booked time is over. Do not allow entry." };
  if (booking.checkedInAt) return { state: "checked_in", message: "This pass was already used to enter." };
  if (now.getTime() < booking.startTime.getTime() - EARLY_ENTRY_MS) {
    return { state: "early", message: "Too early. Entry opens 15 minutes before the booked start time." };
  }
  return { state: "valid", message: "Valid pass. Allow entry." };
}

/** The booking for a pass code, if the caller owns its spot (or is an admin). */
async function bookingForCode(code: string, userId: number, admin: boolean) {
  const cleaned = code.trim().toUpperCase();
  if (!cleaned) return null;
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.verifyCode, cleaned));
  if (!booking) return null;
  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, booking.spotId));
  if (!spot || (!admin && spot.ownerId !== userId)) return null;
  return { booking, spot };
}

async function passResponse(booking: Booking, spotName: string) {
  let driverName: string | null = null;
  if (booking.userId) {
    const [driver] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, booking.userId));
    driverName = driver?.name ?? null;
  }
  const { state, message } = passState(booking);
  return {
    valid: state === "valid",
    state,
    message,
    booking: {
      id: booking.id,
      spotId: booking.spotId,
      spotName: booking.spotName ?? spotName,
      driverName,
      vehicleNumber: booking.vehicleNumber,
      vehicleType: booking.vehicleType,
      startTime: booking.startTime,
      endTime: booking.endTime,
      slotLabel: booking.slotLabel,
      status: booking.status,
      checkedInAt: booking.checkedInAt,
    },
  };
}

const NO_PASS = "No booking with this code at your parking places.";

router.get("/bookings/verify/:code", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const found = await bookingForCode(String(req.params["code"] ?? ""), user.id, isAdmin(user));
  if (!found) {
    res.status(404).json({ error: NO_PASS });
    return;
  }
  res.json(await passResponse(found.booking, found.spot.name));
});

router.post("/bookings/verify/:code/check-in", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const found = await bookingForCode(String(req.params["code"] ?? ""), user.id, isAdmin(user));
  if (!found) {
    res.status(404).json({ error: NO_PASS });
    return;
  }
  const { state, message } = passState(found.booking);
  if (state !== "valid") {
    res.status(409).json({ error: message, state });
    return;
  }
  const [updated] = await db
    .update(bookingsTable)
    .set({ checkedInAt: new Date() })
    .where(eq(bookingsTable.id, found.booking.id))
    .returning();
  res.json({ ...(await passResponse(updated!, found.spot.name)), message: "Entry recorded." });
});

/** "driver" | "owner" | "admin" for this booking, or null if unrelated. */
async function relationTo(booking: Booking, userId: number, admin: boolean) {
  if (admin) return "admin" as const;
  if (booking.userId === userId) return "driver" as const;
  const [spot] = await db
    .select({ ownerId: spotsTable.ownerId })
    .from(spotsTable)
    .where(eq(spotsTable.id, booking.spotId));
  return spot?.ownerId === userId ? ("owner" as const) : null;
}

router.get("/bookings", async (req, res): Promise<void> => {
  await updateBookingStatuses();
  const user = currentUser(res)!;
  const parsed = ListBookingsQueryParams.safeParse(req.query);
  const conditions = [];
  let requestedSpotId: number | null = null;

  if (parsed.success) {
    const { userId, spotId, status } = parsed.data;
    if (userId) conditions.push(eq(bookingsTable.userId, Number(userId)));
    if (spotId) {
      requestedSpotId = Number(spotId);
      conditions.push(eq(bookingsTable.spotId, requestedSpotId));
    }
    if (status) conditions.push(eq(bookingsTable.status, status));
  }

  // Everyone except an admin is limited to bookings they made or bookings on
  // spots they own.
  if (!isAdmin(user)) {
    const owned = await db
      .select({ id: spotsTable.id })
      .from(spotsTable)
      .where(eq(spotsTable.ownerId, user.id));
    const ownedIds = owned.map((s) => s.id);
    const asOwner = requestedSpotId !== null && ownedIds.includes(requestedSpotId);
    if (!asOwner) conditions.push(eq(bookingsTable.userId, user.id));
    else if (ownedIds.length) conditions.push(inArray(bookingsTable.spotId, ownedIds));
  }

  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bookingsTable.createdAt));

  res.json(bookings);
});

/**
 * Books a spot without going through Razorpay. This is used for free reward
 * bookings, and for every booking while the app runs in demo (simulated)
 * payment mode. When Razorpay keys are set, paid bookings must go through
 * POST /payments/checkout instead.
 */
router.post("/bookings", requireRole("driver", "admin"), async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const prepared = await prepareBooking(req.body, user);
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  const free = prepared.useReward || prepared.amount === 0;
  if (!free && paymentSettings().mode === "razorpay") {
    res.status(400).json({ error: "Please pay for this booking through checkout.", code: "PAYMENT_REQUIRED" });
    return;
  }
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      ...prepared.values,
      status: "confirmed",
      paymentStatus: "paid",
      paymentMode: prepared.useReward ? "reward" : "simulated",
      paymentId: prepared.useReward ? "REWARD" : `SIM-${Date.now().toString(36).toUpperCase()}`,
      notes: prepared.useReward ? "Free parking reward" : prepared.values.notes,
    })
    .returning();
  res.status(201).json(booking);
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
  await updateBookingStatuses();
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const user = currentUser(res)!;
  if (!(await relationTo(booking, user.id, isAdmin(user)))) {
    res.status(403).json({ error: "This booking belongs to another user." });
    return;
  }

  res.json(booking);
});

router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const user = currentUser(res)!;
  const relation = await relationTo(existing, user.id, isAdmin(user));
  if (!relation) {
    res.status(403).json({ error: "This booking belongs to another user." });
    return;
  }
  if (relation === "driver") {
    const onlyCancels =
      Object.keys(parsed.data).every((key) => key === "status" || key === "notes") &&
      (parsed.data.status === undefined || parsed.data.status === "cancelled");
    if (!onlyCancels) {
      res.status(403).json({ error: "You can cancel your booking, but not change its status otherwise." });
      return;
    }
  }

  const changes: Partial<typeof bookingsTable.$inferInsert> = { ...parsed.data };

  // Cancelling a paid booking refunds it:
  //   - in full when the driver cancels before the parking time starts
  //   - in full whenever the spot owner or an admin cancels
  //   - not at all when the driver cancels after the start time
  if (parsed.data.status === "cancelled" && existing.status !== "cancelled") {
    Object.assign(changes, await refundFor(existing, relation));
  }

  const [booking] = await db
    .update(bookingsTable)
    .set(changes)
    .where(eq(bookingsTable.id, params.data.id))
    .returning();

  res.json(booking);
});

async function refundFor(existing: Booking, relation: "driver" | "owner" | "admin") {
  if (existing.paymentStatus !== "paid" || existing.paymentMode === "reward" || Number(existing.totalAmount) <= 0) {
    return {};
  }
  const started = Date.now() >= existing.startTime.getTime();
  if (relation === "driver" && started) {
    return { refundError: "No refund: the booking was cancelled after the parking time started." };
  }
  if (existing.paymentMode !== "razorpay" || !existing.paymentId?.startsWith("pay_")) {
    // Demo payment: nothing was charged, so the refund is only recorded.
    return { paymentStatus: "refunded", refundId: "SIMULATED", refundError: null };
  }
  try {
    const refund = await refundPayment(existing.paymentId, `refund_booking_${existing.id}`);
    return { paymentStatus: "refunded", refundId: refund.id, refundError: null };
  } catch (err) {
    const message = err instanceof PaymentError ? err.message : "Refund failed.";
    logger.error({ err, bookingId: existing.id }, "Refund failed");
    return { paymentStatus: "refund_failed", refundError: message };
  }
}

/** Admin: try a failed refund again. */
router.post("/bookings/:id/retry-refund", requireRole("admin"), async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!existing || existing.paymentStatus !== "refund_failed" || !existing.paymentId) {
    res.status(400).json({ error: "This booking has no failed refund to retry." });
    return;
  }
  try {
    const refund = await refundPayment(existing.paymentId, `refund_booking_${existing.id}`);
    const [booking] = await db
      .update(bookingsTable)
      .set({ paymentStatus: "refunded", refundId: refund.id, refundError: null })
      .where(eq(bookingsTable.id, id))
      .returning();
    res.json(booking);
  } catch (err) {
    res.status(502).json({ error: err instanceof PaymentError ? err.message : "Refund failed." });
  }
});

export default router;
