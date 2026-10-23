import { Router, type IRouter } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, spotsTable, type Spot } from "@workspace/db";
import { withLiveAvailability } from "../lib/liveAvailability";
import { distanceKm, findKnownPlace, spotCoordinates } from "../lib/places";

/**
 * Parking assistant search: spots near a named place.
 *
 *   GET /assistant/search?q=saravana stores            the server finds the place
 *   GET /assistant/search?q=...&lat=13.03&lng=80.22    the browser already found it
 *
 * Returns the place that was understood and the active spots closest to it,
 * nearest first, each with its distance from that place. Unlike the map
 * search there is no fixed radius: if nothing is close, the nearest spots are
 * still returned and `nearbyCount` says how many are within `nearbyKm`.
 */
const router: IRouter = Router();

const NEARBY_KM = 3;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function parseCoordinate(value: unknown, limit: number): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** A spot whose name or address contains the text, as the place to search around. */
async function placeFromSpots(query: string) {
  if (query.length < 3) return null;
  const pattern = `%${query.replace(/[%_]/g, " ").replace(/\s+/g, "%")}%`;
  const matches = await db
    .select()
    .from(spotsTable)
    .where(and(eq(spotsTable.isActive, true), or(ilike(spotsTable.name, pattern), ilike(spotsTable.address, pattern))))
    .limit(5);
  for (const spot of matches) {
    const at = spotCoordinates(spot);
    if (at) return { name: spot.name, ...at };
  }
  return null;
}

router.get("/assistant/search", async (req, res): Promise<void> => {
  const query = text(req.query["q"]);
  const vehicleType = text(req.query["vehicleType"]);
  const limit = Math.min(Math.max(Number(req.query["limit"]) || 5, 1), 10);
  const lat = parseCoordinate(req.query["lat"], 90);
  const lng = parseCoordinate(req.query["lng"], 180);

  let place: { name: string; lat: number; lng: number; source: "browser" | "known_place" | "listing" } | null = null;
  if (lat !== null && lng !== null) {
    place = { name: text(req.query["label"]) || query || "that location", lat, lng, source: "browser" };
  } else if (query) {
    const known = findKnownPlace(query);
    if (known) place = { name: known.name, lat: known.lat, lng: known.lng, source: "known_place" };
    else {
      const listed = await placeFromSpots(query);
      if (listed) place = { ...listed, source: "listing" };
    }
  }
  if (!place) {
    res.status(404).json({ error: `I could not find a place called "${query}".` });
    return;
  }

  const conditions = [eq(spotsTable.isActive, true)];
  // A car needs a "car" or "both" spot; the same for a bike.
  if (vehicleType === "car" || vehicleType === "bike") {
    conditions.push(or(eq(spotsTable.vehicleType, vehicleType), eq(spotsTable.vehicleType, "both"))!);
  }
  const spots = await db.select().from(spotsTable).where(and(...conditions));

  const origin = place;
  const ranked = spots
    .map((spot: Spot) => {
      const at = spotCoordinates(spot);
      return at ? { spot, km: distanceKm(origin.lat, origin.lng, at.lat, at.lng) } : null;
    })
    .filter((item): item is { spot: Spot; km: number } => item !== null)
    .sort((a, b) => a.km - b.km);

  const nearest = ranked.slice(0, limit);
  const live = await withLiveAvailability(nearest.map((item) => item.spot));
  res.json({
    place,
    nearbyKm: NEARBY_KM,
    nearbyCount: ranked.filter((item) => item.km <= NEARBY_KM).length,
    spots: live.map((spot, i) => ({ ...spot, distanceKm: Math.round(nearest[i]!.km * 100) / 100 })),
  });
});

export default router;
