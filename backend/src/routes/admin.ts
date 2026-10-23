import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { db, bookingsTable, spotsTable, usersTable } from "@workspace/db";
import { currentUser, publicUser, requireRole, ROLES, type Role } from "../lib/auth";

/**
 * Admin console. Every route here is for admins only.
 *
 *   GET    /admin/users            all users with their listing and booking counts
 *   PATCH  /admin/users/:id/role   change a user's role
 *   GET    /admin/spots            all listings, including deactivated ones
 */
const router: IRouter = Router();
router.use("/admin", requireRole("admin"));

router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const spots = await db
    .select({ ownerId: spotsTable.ownerId, n: count(spotsTable.id) })
    .from(spotsTable)
    .groupBy(spotsTable.ownerId);
  const bookings = await db
    .select({ userId: bookingsTable.userId, n: count(bookingsTable.id) })
    .from(bookingsTable)
    .groupBy(bookingsTable.userId);
  const spotCount = new Map(spots.map((r) => [r.ownerId, Number(r.n)]));
  const bookingCount = new Map(bookings.map((r) => [r.userId, Number(r.n)]));
  res.json(
    users.map((user) => ({
      ...publicUser(user),
      listings: spotCount.get(user.id) ?? 0,
      bookings: bookingCount.get(user.id) ?? 0,
    })),
  );
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const role = req.body?.role as Role;
  if (!Number.isInteger(id) || !ROLES.includes(role)) {
    res.status(400).json({ error: "Role must be driver, owner or admin." });
    return;
  }
  if (id === currentUser(res)!.id && role !== "admin") {
    res.status(400).json({ error: "You cannot remove your own admin role." });
    return;
  }
  const [user] = await db.update(usersTable).set({ role }).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

router.get("/admin/spots", async (_req, res): Promise<void> => {
  const spots = await db.select().from(spotsTable).orderBy(spotsTable.id);
  const owners = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  res.json(spots.map((spot) => ({ ...spot, ownerName: spot.ownerId ? ownerName.get(spot.ownerId) ?? null : null })));
});

export default router;
