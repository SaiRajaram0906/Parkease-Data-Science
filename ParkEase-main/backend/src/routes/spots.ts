import { Router, type IRouter } from "express";
import { eq, ilike, and, lte, or, sql } from "drizzle-orm";
import { db, spotsTable, reviewsTable, usersTable } from "@workspace/db";
import {
  ListSpotsQueryParams,
  CreateSpotBody,
  GetSpotParams,
  UpdateSpotParams,
  UpdateSpotBody,
  DeleteSpotParams,
  GetSpotReviewsParams,
} from "@workspace/api-zod";
import { withLiveAvailability } from "../lib/liveAvailability";
import { allowSelfOrAdmin, currentUser, isAdmin, requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/spots", async (req, res): Promise<void> => {
  const parsed = ListSpotsQueryParams.safeParse(req.query);
  const conditions = [];

  if (parsed.success) {
    const { city, vehicleType, available, maxPrice, search, lat, lng } = parsed.data;
    if (city) conditions.push(ilike(spotsTable.city, `%${city}%`));
    if (vehicleType) conditions.push(eq(spotsTable.vehicleType, vehicleType));
    if (available === "true") conditions.push(eq(spotsTable.isActive, true));
    if (maxPrice) conditions.push(lte(spotsTable.pricePerHour, maxPrice));
    
    if (lat && lng) {
      // 500m radius search using a more stable Spherical Law of Cosines
      // We cast text coordinates to numeric for Postgres math functions
      conditions.push(
        sql`6371 * acos(
          LEAST(1, GREATEST(-1, 
            cos(radians(${lat})) * cos(radians(CAST(${spotsTable.latitude} AS NUMERIC))) *
            cos(radians(CAST(${spotsTable.longitude} AS NUMERIC)) - radians(${lng})) +
            sin(radians(${lat})) * sin(radians(CAST(${spotsTable.latitude} AS NUMERIC)))
          ))
        ) <= 0.5`
      );
    } else if (search) {
      conditions.push(
        or(
          ilike(spotsTable.name, `%${search}%`),
          ilike(spotsTable.address, `%${search}%`),
          ilike(spotsTable.city, `%${search}%`)
        )
      );
    }
  }

  conditions.push(eq(spotsTable.isActive, true));

  const spots = await db
    .select()
    .from(spotsTable)
    .where(and(...conditions));

  // availableSlots is computed from live bookings (see lib/liveAvailability).
  res.json(await withLiveAvailability(spots));
});

// Any signed-in user may list a spot. It belongs to them (an admin may list on
// behalf of another owner), and a driver who lists a spot becomes an owner.
router.post("/spots", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateSpotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { totalSlots, ...rest } = parsed.data;
  // The price-per-day column is numeric, so an empty string from the form
  // must be stored as "no value" rather than rejected by the database.
  const pricePerDay = rest.pricePerDay?.trim() ? rest.pricePerDay : null;
  const user = currentUser(res)!;
  const ownerId = isAdmin(user) && rest.ownerId ? rest.ownerId : user.id;
  const [spot] = await db
    .insert(spotsTable)
    .values({ ...rest, ownerId, pricePerDay, totalSlots, availableSlots: totalSlots })
    .returning();

  if (user.role === "driver") {
    await db.update(usersTable).set({ role: "owner" }).where(eq(usersTable.id, user.id));
  }

  res.status(201).json(spot);
});

router.get("/spots/:id", async (req, res): Promise<void> => {
  const params = GetSpotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [spot] = await db
    .select()
    .from(spotsTable)
    .where(eq(spotsTable.id, params.data.id));

  if (!spot) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }

  const [withAvailability] = await withLiveAvailability([spot]);
  res.json(withAvailability);
});

// Only the spot's owner or an admin may change it.
router.patch("/spots/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateSpotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSpotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(spotsTable).where(eq(spotsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }
  if (!allowSelfOrAdmin(res, existing.ownerId)) return;

  const [spot] = await db
    .update(spotsTable)
    .set(parsed.data)
    .where(eq(spotsTable.id, params.data.id))
    .returning();

  if (!spot) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }

  res.json(spot);
});

// Only the spot's owner or an admin may delete it.
router.delete("/spots/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteSpotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(spotsTable).where(eq(spotsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }
  if (!allowSelfOrAdmin(res, existing.ownerId)) return;

  const [spot] = await db
    .delete(spotsTable)
    .where(eq(spotsTable.id, params.data.id))
    .returning();

  if (!spot) {
    res.status(404).json({ error: "Spot not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/spots/:id/reviews", async (req, res): Promise<void> => {
  const params = GetSpotReviewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.spotId, params.data.id));

  res.json(reviews);
});

export default router;
