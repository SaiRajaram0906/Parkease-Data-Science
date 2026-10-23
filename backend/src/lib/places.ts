import { eq } from "drizzle-orm";
import { db, spotsTable, usersTable, type Spot } from "@workspace/db";
import { logger } from "./logger";

/** Straight-line distance between two points, in kilometres. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function spotCoordinates(spot: Pick<Spot, "latitude" | "longitude">): { lat: number; lng: number } | null {
  const lat = Number(spot.latitude);
  const lng = Number(spot.longitude);
  if (!spot.latitude || !spot.longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Well-known places around Chennai with approximate coordinates. Used by the
 * parking assistant when Google Maps cannot look a place up. `names` are
 * lower-case spellings people type, including common misspellings.
 */
export interface KnownPlace {
  name: string;
  names: string[];
  lat: number;
  lng: number;
}

export const KNOWN_PLACES: KnownPlace[] = [
  { name: "Rajalakshmi Engineering College, Thandalam", names: ["rajalakshmi engineering college", "rajalakshmi college", "rajalakshmi", "rec thandalam", "thandalam"], lat: 13.0089, lng: 80.0035 },
  { name: "Saravana Stores, T. Nagar", names: ["saravana stores", "saravana store", "super saravana stores", "saravana"], lat: 13.0371, lng: 80.2293 },
  { name: "Jeyachandran Textiles, T. Nagar", names: ["jeyachandran textiles", "jeyachandran", "jayachandran textiles", "jayachandran", "jayachandra"], lat: 13.0405, lng: 80.2335 },
  { name: "Ranganathan Street, T. Nagar", names: ["ranganathan street", "ranganathan st"], lat: 13.0371, lng: 80.2293 },
  { name: "Panagal Park, T. Nagar", names: ["panagal park"], lat: 13.0413, lng: 80.2331 },
  { name: "Pondy Bazaar, T. Nagar", names: ["pondy bazaar", "pondy bazar", "thyagaraya road"], lat: 13.0404, lng: 80.24 },
  { name: "T. Nagar", names: ["t nagar", "t. nagar", "t.nagar", "tnagar", "t-nagar", "thyagaraya nagar", "theagaraya nagar"], lat: 13.0418, lng: 80.2341 },
  { name: "Anna Nagar", names: ["anna nagar", "annanagar"], lat: 13.085, lng: 80.2101 },
  { name: "Adyar", names: ["adyar"], lat: 13.0012, lng: 80.2565 },
  { name: "Velachery", names: ["velachery"], lat: 12.9815, lng: 80.218 },
  { name: "Guindy", names: ["guindy"], lat: 13.0067, lng: 80.2206 },
  { name: "Mylapore", names: ["mylapore"], lat: 13.0339, lng: 80.2619 },
  { name: "Egmore", names: ["egmore"], lat: 13.0732, lng: 80.2609 },
  { name: "Nungambakkam", names: ["nungambakkam"], lat: 13.0569, lng: 80.2425 },
  { name: "Kodambakkam", names: ["kodambakkam"], lat: 13.0521, lng: 80.2255 },
  { name: "Vadapalani", names: ["vadapalani"], lat: 13.05, lng: 80.2121 },
  { name: "Koyambedu", names: ["koyambedu", "cmbt"], lat: 13.0694, lng: 80.1948 },
  { name: "Tambaram", names: ["tambaram"], lat: 12.9249, lng: 80.1 },
  { name: "Porur", names: ["porur"], lat: 13.0382, lng: 80.1565 },
  { name: "Poonamallee", names: ["poonamallee"], lat: 13.0473, lng: 80.0945 },
  { name: "Sriperumbudur", names: ["sriperumbudur"], lat: 12.9675, lng: 79.9419 },
  { name: "Marina Beach", names: ["marina beach", "marina"], lat: 13.05, lng: 80.2824 },
  { name: "Chennai Central", names: ["chennai central", "central station", "central railway station"], lat: 13.0827, lng: 80.2757 },
  { name: "Chennai Airport", names: ["chennai airport", "airport", "meenambakkam"], lat: 12.9941, lng: 80.1709 },
  { name: "Chennai", names: ["chennai", "madras"], lat: 13.0827, lng: 80.2707 },
];

const simplify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** The known place whose name appears in the text. Longer names win. */
export function findKnownPlace(text: string): KnownPlace | null {
  const query = ` ${simplify(text)} `;
  let best: { place: KnownPlace; length: number } | null = null;
  for (const place of KNOWN_PLACES) {
    for (const name of place.names) {
      const needle = simplify(name);
      if (query.includes(` ${needle} `) && (!best || needle.length > best.length)) {
        best = { place, length: needle.length };
      }
    }
  }
  return best?.place ?? null;
}

/**
 * Large parking places added automatically, owned by the demo owner account.
 * They are demo listings: the number of slots and the prices are examples,
 * not figures published by these businesses, and the map pins are approximate
 * (Get Directions searches Google Maps for the place by name instead).
 */
const BIG_PLACES = [
  {
    name: "Saravana Stores Parking, T. Nagar",
    place: "Super Saravana Stores",
    address: "Ranganathan Street, T. Nagar, Chennai 600017",
    latitude: "13.0371",
    longitude: "80.2293",
    directionsQuery: "Super Saravana Stores, Ranganathan Street, T. Nagar, Chennai",
    pricePerHour: "40",
    pricePerDay: "300",
    totalSlots: 120,
  },
  {
    name: "Jeyachandran Textiles Parking, T. Nagar",
    place: "Jeyachandran Textiles",
    address: "Usman Road, T. Nagar, Chennai 600017",
    latitude: "13.0405",
    longitude: "80.2335",
    directionsQuery: "Jeyachandran Textiles, Usman Road, T. Nagar, Chennai",
    pricePerHour: "40",
    pricePerDay: "300",
    totalSlots: 80,
  },
  {
    name: "Pondy Bazaar Parking, T. Nagar",
    place: "Pondy Bazaar",
    address: "Thyagaraya Road, Pondy Bazaar, T. Nagar, Chennai 600017",
    latitude: "13.0404",
    longitude: "80.2400",
    directionsQuery: "Pondy Bazaar, Thyagaraya Road, T. Nagar, Chennai",
    pricePerHour: "30",
    pricePerDay: "250",
    totalSlots: 150,
  },
  {
    name: "Panagal Park Parking, T. Nagar",
    place: "Panagal Park",
    address: "Panagal Park, T. Nagar, Chennai 600017",
    latitude: "13.0413",
    longitude: "80.2331",
    directionsQuery: "Panagal Park, T. Nagar, Chennai",
    pricePerHour: "30",
    pricePerDay: "250",
    totalSlots: 60,
  },
  {
    name: "Thandalam Parking near Rajalakshmi Engineering College",
    place: "Rajalakshmi Engineering College",
    address: "Rajalakshmi Nagar, Thandalam, Chennai 602105",
    latitude: "13.0089",
    longitude: "80.0035",
    directionsQuery: "Rajalakshmi Engineering College, Thandalam, Chennai",
    pricePerHour: "20",
    pricePerDay: "120",
    totalSlots: 100,
  },
];

const DEMO_OWNER = { name: "Rajesh Kumar", email: "rajesh.kumar@gmail.com", role: "owner" };

/** Adds the large parking places that are not in the database yet. Only adds rows. */
export async function ensureBigPlaces(): Promise<void> {
  try {
    const existing = await db.select({ name: spotsTable.name }).from(spotsTable);
    const present = new Set(existing.map((row) => row.name));
    const missing = BIG_PLACES.filter((place) => !present.has(place.name));
    if (!missing.length) return;

    let [owner] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_OWNER.email));
    if (!owner) [owner] = await db.insert(usersTable).values(DEMO_OWNER).returning();

    for (const place of missing) {
      await db.insert(spotsTable).values({
        ownerId: owner!.id,
        name: place.name,
        description:
          `Large parking facility for ${place.place}. Every booking keeps a numbered slot for you ` +
          "and gives you a QR code; show it to the staff at the entrance to be let in.\n\n" +
          "Demo listing: the number of slots and the prices are examples, not figures published by " +
          `${place.place}, and ParkEase is not affiliated with it. The map pin is approximate; ` +
          "Get Directions opens Google Maps for the place by name.",
        address: place.address,
        city: "Chennai",
        state: "Tamil Nadu",
        latitude: place.latitude,
        longitude: place.longitude,
        directionsQuery: place.directionsQuery,
        pricePerHour: place.pricePerHour,
        pricePerDay: place.pricePerDay,
        vehicleType: "both",
        totalSlots: place.totalSlots,
        availableSlots: place.totalSlots,
        amenities: "cctv,security,covered",
        isLargeFacility: true,
      });
    }
    logger.info({ added: missing.length }, "Large parking places added");
  } catch (err) {
    logger.error({ err }, "Could not add the large parking places");
  }
}
