import { Router, type IRouter } from "express";
import { eq, count, sum, desc, ne, and } from "drizzle-orm";
import { db, spotsTable, bookingsTable, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { updateBookingStatuses } from "../lib/tasks";

import { requireRole } from "../lib/auth";

const router: IRouter = Router();

// Platform-wide figures (all revenue, all users, all bookings) are for admins.
router.use("/dashboard", requireRole("admin"));

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  await updateBookingStatuses();
  const [spotsStats] = await db
    .select({
      totalSpots: count(spotsTable.id),
    })
    .from(spotsTable);

  const [bookingsStats] = await db
    .select({
      totalBookings: count(bookingsTable.id),
      totalRevenue: sum(bookingsTable.totalAmount),
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "completed"));

  const [activeBookings] = await db
    .select({ count: count(bookingsTable.id) })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "confirmed"));

  const [usersStats] = await db
    .select({ totalUsers: count(usersTable.id) })
    .from(usersTable);

  const [availableStats] = await db
    .select({ availableSpots: count(spotsTable.id) })
    .from(spotsTable)
    .where(eq(spotsTable.isActive, true));

  res.json({
    totalSpots: spotsStats?.totalSpots ?? 0,
    totalBookings: bookingsStats?.totalBookings ?? 0,
    totalRevenue: bookingsStats?.totalRevenue ?? "0",
    activeBookings: activeBookings?.count ?? 0,
    totalUsers: usersStats?.totalUsers ?? 0,
    availableSpots: availableStats?.availableSpots ?? 0,
  });
});

router.get("/dashboard/recent-bookings", async (_req, res): Promise<void> => {
  await updateBookingStatuses();
  const bookings = await db
    .select()
    .from(bookingsTable)
    .orderBy(desc(bookingsTable.createdAt))
    .limit(10);

  res.json(bookings);
});

router.get("/dashboard/city-breakdown", async (_req, res): Promise<void> => {
  const cityData = await db
    .select({
      city: spotsTable.city,
      bookingCount: count(bookingsTable.id),
      revenue: sum(bookingsTable.totalAmount),
      spotCount: sql<number>`count(distinct ${spotsTable.id})`,
    })
    .from(spotsTable)
    .leftJoin(
      bookingsTable,
      and(
        eq(spotsTable.id, bookingsTable.spotId),
        eq(bookingsTable.status, "completed")
      )
    )
    .groupBy(spotsTable.city)
    .orderBy(desc(count(bookingsTable.id)));

  res.json(
    cityData.map((row) => ({
      city: row.city,
      bookingCount: Number(row.bookingCount),
      revenue: row.revenue ?? "0",
      spotCount: Number(row.spotCount),
    }))
  );
});

router.get("/dashboard/top-spots", async (_req, res): Promise<void> => {
  await updateBookingStatuses();
  const spots = await db
    .select({
      id: spotsTable.id,
      name: spotsTable.name,
      city: spotsTable.city,
      pricePerHour: spotsTable.pricePerHour,
      totalSlots: spotsTable.totalSlots,
      rating: spotsTable.rating,
      totalReviews: spotsTable.totalReviews,
      completedBookings: count(bookingsTable.id),
      totalRevenue: sum(bookingsTable.totalAmount),
    })
    .from(spotsTable)
    .leftJoin(
      bookingsTable,
      and(
        eq(spotsTable.id, bookingsTable.spotId),
        eq(bookingsTable.status, "completed")
      )
    )
    .groupBy(spotsTable.id)
    .orderBy(desc(sum(bookingsTable.totalAmount)), desc(spotsTable.rating))
    .limit(6);

  res.json(spots);
});

export default router;
