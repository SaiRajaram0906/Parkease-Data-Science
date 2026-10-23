import { Router, type IRouter } from "express";
import { eq, and, desc, lt, gt, ne, inArray } from "drizzle-orm";
import { db, bookingsTable, spotsTable, type Booking } from "@workspace/db";
import { updateBookingStatuses } from "../lib/tasks";
import {
  ListBookingsQueryParams,
  CreateBookingBody,
  GetBookingParams,
  UpdateBookingParams,
  UpdateBookingBody,
} from "@workspace/api-zod";
import { currentUser, isAdmin, requireAuth } from "../lib/auth";

/**
 * Bookings. Every route needs a signed-in user.
 *
 * Who may see or change a booking:
 *   the driver who made it, the owner of the booked spot, or an admin.
 * The driver may only cancel; the owner and admins may also confirm or
 * complete it.
 */
const router: IRouter = Router();
router.use("/bookings", requireAuth);

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

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const spot = await db
    .select()
    .from(spotsTable)
    .where(eq(spotsTable.id, parsed.data.spotId));

  if (!spot[0]) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }
  if (!spot[0].isActive) {
    res.status(400).json({ error: "This spot is not accepting bookings right now." });
    return;
  }

  const requestedStart = new Date(parsed.data.startTime);
  const requestedEnd = new Date(parsed.data.endTime);

  // Check for overlaps with existing confirmed/completed bookings
  // A booking overlaps if: (ExistingStart < RequestedEnd) AND (ExistingEnd > RequestedStart)
  const overlappingBookings = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.spotId, parsed.data.spotId),
        ne(bookingsTable.status, "cancelled"), // Consider both confirmed and completed
        lt(bookingsTable.startTime, requestedEnd),
        gt(bookingsTable.endTime, requestedStart)
      )
    );

  if (overlappingBookings.length >= spot[0].totalSlots) {
    res.status(400).json({ error: "The chosen time slot is already booked. Please select a different time." });
    return;
  }

  const user = currentUser(res)!;
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      ...parsed.data,
      // A booking always belongs to the signed-in user.
      userId: user.id,
      userEmail: user.email,
      startTime: requestedStart,
      endTime: requestedEnd,
      spotName: spot[0].name,
      status: "confirmed",
      paymentStatus: "pending",
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

  const [booking] = await db
    .update(bookingsTable)
    .set(parsed.data)
    .where(eq(bookingsTable.id, params.data.id))
    .returning();

  res.json(booking);
});

export default router;
