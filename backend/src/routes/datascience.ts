import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db, spotsTable, bookingsTable, usersTable, type Spot, type Booking } from "@workspace/db";
import { mlGet, mlPost, MlServiceError } from "../lib/mlClient";
import { bookedCounts, freeSpaces } from "../lib/liveAvailability";
import { hourWindow, isValidDate, localNow } from "../lib/localTime";
import { logger } from "../lib/logger";
import { allowSelfOrAdmin, requireAuth, requireRole } from "../lib/auth";

/**
 * Data Science endpoints.
 *
 * Each route takes live ParkEase data from the database (spots, bookings,
 * the user), hands it to the Data Science service, and returns the result.
 * Predictions come from trained models; nothing here is hardcoded.
 *
 *   GET  /analytics/driver/:driverId      driver analytics
 *   GET  /analytics/owner/:ownerId        slot performance analytics
 *   GET  /analytics/parking-overview      EDA of the historical dataset
 *   GET  /analytics/data-quality          validation and cleaning reports
 *   GET  /predictions/availability        availability prediction
 *   GET  /predictions/demand              demand forecast
 *   GET  /recommendations/parking         smart parking recommendation
 *   GET  /recommendations/price           smart price recommendation
 *   GET  /models/performance              model evaluation
 *   GET  /datascience/health              service status
 *   POST /datascience/seed-demo           add linked demo accounts and spots
 *
 * Permissions:
 *   any signed-in user   availability prediction
 *   driver or admin      parking recommendation
 *   the user or an admin their own driver / owner analytics
 *   spot owner or admin  demand forecast and price recommendation of a spot
 *   owner or admin       dataset EDA, data quality, model performance, demo data
 */
const router: IRouter = Router();

type AnyRecord = Record<string, unknown>;

function sendError(res: Response, err: unknown): void {
  if (err instanceof MlServiceError) {
    res.status(err.status).json({ error: err.message, hint: err.hint, service: "data-science" });
    return;
  }
  logger.error({ err }, "Data Science route failed");
  res.status(500).json({ error: "Unexpected error in the Data Science route." });
}

/** A live spot in the shape the Data Science service expects. */
function toMlSpot(spot: Spot, currentAvailable?: number): AnyRecord {
  const latitude = spot.latitude ? Number(spot.latitude) : null;
  const longitude = spot.longitude ? Number(spot.longitude) : null;
  return {
    id: spot.id,
    name: spot.name,
    city: spot.city,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    price_per_hour: Number(spot.pricePerHour),
    total_slots: spot.totalSlots,
    vehicle_type: spot.vehicleType,
    is_active: spot.isActive,
    dataset_slot_id: spot.datasetSlotId,
    current_available: currentAvailable,
  };
}

function toMlBooking(booking: Booking): AnyRecord {
  return {
    id: booking.id,
    spot_id: booking.spotId,
    start_time: booking.startTime.toISOString(),
    duration_hours: Number(booking.durationHours),
    total_amount: Number(booking.totalAmount),
    status: booking.status,
  };
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Reads ?date=YYYY-MM-DD and ?hour=0..23. Missing values mean "now". */
function parseWhen(req: Request): { date: string; hour: number | null; error?: string } {
  const now = localNow();
  const rawDate = typeof req.query["date"] === "string" ? req.query["date"] : "";
  const rawHour = typeof req.query["hour"] === "string" ? req.query["hour"] : "";
  if (rawDate && !isValidDate(rawDate)) return { date: now.date, hour: null, error: "date must be YYYY-MM-DD" };
  let hour: number | null = null;
  if (rawHour !== "") {
    hour = Number(rawHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { date: now.date, hour: null, error: "hour must be a whole number from 0 to 23" };
    }
  }
  return { date: rawDate || now.date, hour };
}

async function loadSpot(req: Request, res: Response): Promise<Spot | null> {
  const id = parseId(req.query["spotId"]);
  if (!id) {
    res.status(400).json({ error: "spotId is required" });
    return null;
  }
  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, id));
  if (!spot) {
    res.status(404).json({ error: "Spot not found" });
    return null;
  }
  return spot;
}

// ---------------------------------------------------------------------------
// Status and dataset-level analytics
// ---------------------------------------------------------------------------
router.get("/datascience/health", async (_req, res): Promise<void> => {
  try {
    res.json(await mlGet("/health"));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/analytics/parking-overview", requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  try {
    res.json(await mlGet("/analytics/overview"));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/analytics/data-quality", requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  try {
    res.json(await mlGet("/dataset/validation"));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/models/performance", requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  try {
    res.json(await mlGet("/models/performance"));
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Driver analytics
// ---------------------------------------------------------------------------
router.get("/analytics/driver/:driverId", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params["driverId"]);
  if (!id) {
    res.status(400).json({ error: "Invalid driver id" });
    return;
  }
  if (!allowSelfOrAdmin(res, id)) return;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const liveBookings = await db.select().from(bookingsTable).where(eq(bookingsTable.userId, id));
    const account = { id: user.id, name: user.name, role: user.role, liveBookings: liveBookings.length };

    // A demo account linked to the historical dataset shows that history.
    if (user.datasetUserId) {
      const analytics = await mlGet<AnyRecord>(`/analytics/driver/${encodeURIComponent(user.datasetUserId)}`);
      res.json({ ...analytics, user: account, linked: true });
      return;
    }
    // Any other account is analysed from its own live bookings.
    const spotIds = [...new Set(liveBookings.map((b) => b.spotId))];
    const spots = spotIds.length
      ? await db.select().from(spotsTable).where(inArray(spotsTable.id, spotIds))
      : [];
    const analytics = await mlPost<AnyRecord>("/analytics/driver", {
      bookings: liveBookings.map(toMlBooking),
      spots: spots.map((s) => toMlSpot(s)),
    });
    res.json({ ...analytics, user: account, linked: false });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Owner analytics (slot performance)
// ---------------------------------------------------------------------------
router.get("/analytics/owner/:ownerId", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params["ownerId"]);
  if (!id) {
    res.status(400).json({ error: "Invalid owner id" });
    return;
  }
  if (!allowSelfOrAdmin(res, id)) return;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const spots = await db.select().from(spotsTable).where(eq(spotsTable.ownerId, id));
    const spotSummaries = spots.map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      pricePerHour: Number(s.pricePerHour),
      totalSlots: s.totalSlots,
      vehicleType: s.vehicleType,
      isActive: s.isActive,
      datasetSlotId: s.datasetSlotId,
    }));
    const account = { id: user.id, name: user.name, role: user.role };

    let analytics: AnyRecord;
    if (user.datasetUserId) {
      analytics = await mlGet<AnyRecord>(`/analytics/owner/${encodeURIComponent(user.datasetUserId)}`);
    } else {
      const spotIds = spots.map((s) => s.id);
      const bookings = spotIds.length
        ? await db.select().from(bookingsTable).where(inArray(bookingsTable.spotId, spotIds))
        : [];
      analytics = await mlPost<AnyRecord>("/analytics/owner", {
        bookings: bookings.map(toMlBooking),
        spots: spots.map((s) => toMlSpot(s)),
      });
    }

    // Attach the live spot (name, id) to each per-slot row.
    const bySlot = Array.isArray(analytics["by_slot"]) ? (analytics["by_slot"] as AnyRecord[]) : [];
    const named = bySlot.map((row) => {
      const key = String(row["slot_id"]);
      const match = spots.find((s) => s.datasetSlotId === key || String(s.id) === key);
      return { ...row, spot_id: match?.id ?? null, name: match?.name ?? key };
    });
    res.json({ ...analytics, by_slot: named, user: account, linked: Boolean(user.datasetUserId), spots: spotSummaries });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Availability prediction (driver)
// ---------------------------------------------------------------------------
router.get("/predictions/availability", requireAuth, async (req, res): Promise<void> => {
  const when = parseWhen(req);
  if (when.error) {
    res.status(400).json({ error: when.error });
    return;
  }
  try {
    const spot = await loadSpot(req, res);
    if (!spot) return;
    const now = localNow();
    const focusHour = when.hour ?? now.hour;

    // Actual figure: spaces not taken by live bookings in the chosen hour.
    const window = hourWindow(when.date, focusHour);
    const counts = await bookedCounts(window.start, window.end, [spot.id]);
    const booked = counts.get(spot.id) ?? 0;

    const forecast = await mlPost<AnyRecord>("/predict/availability", {
      spot: toMlSpot(spot),
      date: when.date,
    });
    res.json({
      ...forecast,
      focus_hour: focusHour,
      is_today: when.date === now.date,
      current_hour: now.hour,
      live: {
        date: when.date,
        hour: focusHour,
        total_slots: spot.totalSlots,
        booked,
        available: freeSpaces(spot.totalSlots, booked),
        source: "live ParkEase bookings (actual, not a prediction)",
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Demand forecast (owner)
// ---------------------------------------------------------------------------
router.get("/predictions/demand", requireAuth, async (req, res): Promise<void> => {
  const when = parseWhen(req);
  if (when.error) {
    res.status(400).json({ error: when.error });
    return;
  }
  try {
    const spot = await loadSpot(req, res);
    if (!spot) return;
    if (!allowSelfOrAdmin(res, spot.ownerId)) return;
    const forecast = await mlPost<AnyRecord>("/predict/demand", { spot: toMlSpot(spot), date: when.date });
    const now = localNow();
    res.json({ ...forecast, is_today: when.date === now.date, current_hour: now.hour });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Smart price recommendation (owner). Never changes a price by itself: the
// owner applies a suggestion through the existing PATCH /spots/:id.
// ---------------------------------------------------------------------------
router.get("/recommendations/price", requireAuth, async (req, res): Promise<void> => {
  const when = parseWhen(req);
  if (when.error) {
    res.status(400).json({ error: when.error });
    return;
  }
  try {
    const spot = await loadSpot(req, res);
    if (!spot) return;
    if (!allowSelfOrAdmin(res, spot.ownerId)) return;
    const result = await mlPost<AnyRecord>("/recommend/price", {
      spot: toMlSpot(spot),
      date: when.date,
      hour: when.hour,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Smart parking recommendation (driver)
// ---------------------------------------------------------------------------
const WEIGHT_PARAMS: Record<string, string> = {
  wAvailability: "availability",
  wDistance: "distance",
  wPrice: "price",
  wHistory: "history",
};

router.get("/recommendations/parking", requireRole("driver", "admin"), async (req, res): Promise<void> => {
  const when = parseWhen(req);
  if (when.error) {
    res.status(400).json({ error: when.error });
    return;
  }
  const lat = req.query["lat"] !== undefined ? Number(req.query["lat"]) : NaN;
  const lng = req.query["lng"] !== undefined ? Number(req.query["lng"]) : NaN;
  const hasOrigin = Number.isFinite(lat) && Number.isFinite(lng);
  const vehicle = typeof req.query["vehicleType"] === "string" ? req.query["vehicleType"] : undefined;
  const limit = Math.min(Math.max(Number(req.query["limit"]) || 5, 1), 20);
  const radius = Number(req.query["radiusKm"]);

  const weights: Record<string, number> = {};
  for (const [param, name] of Object.entries(WEIGHT_PARAMS)) {
    const value = Number(req.query[param]);
    if (req.query[param] !== undefined && Number.isFinite(value) && value >= 0) weights[name] = value;
  }

  try {
    const now = localNow();
    const hour = when.hour ?? now.hour;
    const spots = await db.select().from(spotsTable).where(eq(spotsTable.isActive, true));
    const window = hourWindow(when.date, hour);
    const counts = await bookedCounts(window.start, window.end, spots.map((s) => s.id));

    const result = await mlPost<AnyRecord>("/recommend/parking", {
      spots: spots.map((s) => toMlSpot(s, freeSpaces(s.totalSlots, counts.get(s.id)))),
      date: when.date,
      hour,
      origin: hasOrigin ? { latitude: lat, longitude: lng } : null,
      vehicle: vehicle && vehicle !== "all" ? vehicle : null,
      weights: Object.keys(weights).length ? weights : null,
      limit,
      radius_km: Number.isFinite(radius) && radius > 0 ? radius : undefined,
    });

    // Add what the card needs to display from the live spot record.
    const byId = new Map(spots.map((s) => [s.id, s]));
    const ranked = (result["recommendations"] as AnyRecord[]).map((item) => {
      const spot = byId.get(Number(item["spot_id"]));
      return {
        ...item,
        address: spot?.address ?? null,
        city: spot?.city ?? null,
        image_url: spot?.imageUrl ?? null,
        vehicle_type: spot?.vehicleType ?? null,
        total_slots: spot?.totalSlots ?? null,
      };
    });
    res.json({ ...result, recommendations: ranked, has_origin: hasOrigin, is_today: when.date === now.date });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Demo data. Adds accounts and spots that are linked to the historical
// dataset so the dashboards have a year of history to show. It only inserts
// rows that are missing; it never updates or deletes existing ParkEase data,
// except to fill an empty link on the three demo accounts.
// ---------------------------------------------------------------------------
const VEHICLE_TO_LIVE: Record<string, string> = {
  "Two-Wheeler": "bike",
  Car: "car",
  SUV: "car",
  All: "both",
};

interface DemoLinks {
  demo_driver: { dataset_user_id: string };
  demo_owner: { dataset_user_id: string };
  other_owners: { dataset_user_id: string }[];
  listings: {
    dataset_slot_id: string;
    dataset_owner_id: string;
    parking_zone: string;
    name: string;
    latitude: number;
    longitude: number;
    capacity: number;
    base_price_per_hour: number;
    vehicle_type_supported: string;
  }[];
}

async function ensureUser(name: string, email: string, role: string, datasetUserId: string | null) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    if (!existing.datasetUserId && datasetUserId) {
      const [updated] = await db
        .update(usersTable)
        .set({ datasetUserId })
        .where(eq(usersTable.id, existing.id))
        .returning();
      return { user: updated!, created: false };
    }
    return { user: existing, created: false };
  }
  const [created] = await db.insert(usersTable).values({ name, email, role, datasetUserId }).returning();
  return { user: created!, created: true };
}

router.post("/datascience/seed-demo", requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  try {
    const links = await mlGet<DemoLinks>("/demo/links");
    let usersCreated = 0;
    let spotsCreated = 0;

    const owner = await ensureUser("Rajesh Kumar", "rajesh.kumar@gmail.com", "owner", links.demo_owner.dataset_user_id);
    const driver = await ensureUser("Priya Sharma", "priya.sharma@gmail.com", "driver", links.demo_driver.dataset_user_id);
    const admin = await ensureUser("Vikram Nair", "vikram.nair@gmail.com", "admin", null);
    usersCreated += [owner, driver, admin].filter((r) => r.created).length;

    const ownerIds = new Map<string, number>([[links.demo_owner.dataset_user_id, owner.user.id]]);
    for (const other of links.other_owners) {
      const id = other.dataset_user_id;
      const result = await ensureUser(`Demo Owner ${id}`, `${id.toLowerCase()}@demo.parkease.in`, "owner", id);
      if (result.created) usersCreated += 1;
      ownerIds.set(id, result.user.id);
    }

    const existing = await db
      .select({ datasetSlotId: spotsTable.datasetSlotId })
      .from(spotsTable)
      .where(isNotNull(spotsTable.datasetSlotId));
    const present = new Set(existing.map((row) => row.datasetSlotId));

    for (const listing of links.listings) {
      if (present.has(listing.dataset_slot_id)) continue;
      await db.insert(spotsTable).values({
        ownerId: ownerIds.get(listing.dataset_owner_id) ?? null,
        name: listing.name,
        description:
          `Demo listing linked to ${listing.dataset_slot_id} of the synthetic historical dataset. ` +
          "Its location is generated and does not mark a real parking space.",
        address: `${listing.parking_zone} (synthetic demo location)`,
        city: "Chennai",
        state: "Tamil Nadu",
        latitude: String(listing.latitude),
        longitude: String(listing.longitude),
        pricePerHour: String(listing.base_price_per_hour),
        vehicleType: VEHICLE_TO_LIVE[listing.vehicle_type_supported] ?? "both",
        totalSlots: listing.capacity,
        availableSlots: listing.capacity,
        datasetSlotId: listing.dataset_slot_id,
      });
      spotsCreated += 1;
    }

    res.json({
      usersCreated,
      spotsCreated,
      linkedListings: links.listings.length,
      demoAccounts: {
        driver: { id: driver.user.id, email: driver.user.email, datasetUserId: driver.user.datasetUserId },
        owner: { id: owner.user.id, email: owner.user.email, datasetUserId: owner.user.datasetUserId },
        admin: { id: admin.user.id, email: admin.user.email },
      },
      note: "Demo spots use synthetic locations. Existing ParkEase data was not changed.",
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
