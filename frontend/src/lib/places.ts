/**
 * Location helpers: reading a Google geocoding result, a small offline list
 * of Indian cities (used when Google cannot be reached), and the link that
 * "Get Directions" opens.
 */

export interface PlaceDetails {
  address?: string;
  city?: string;
  state?: string;
}

type AddressComponent = { long_name: string; types: string[] };

/** City, state and full address from one Google geocoding result. */
export function readGeocoderResult(result: { formatted_address?: string; address_components?: AddressComponent[] }): PlaceDetails {
  const find = (...types: string[]) => {
    for (const type of types) {
      const hit = result.address_components?.find((c) => c.types.includes(type));
      if (hit) return hit.long_name;
    }
    return undefined;
  };
  return {
    address: result.formatted_address,
    city: find("locality", "administrative_area_level_3", "administrative_area_level_2", "sublocality_level_1"),
    state: find("administrative_area_level_1"),
  };
}

const CITIES: Array<[city: string, state: string, lat: number, lng: number]> = [
  ["Chennai", "Tamil Nadu", 13.0827, 80.2707],
  ["Coimbatore", "Tamil Nadu", 11.0168, 76.9558],
  ["Madurai", "Tamil Nadu", 9.9252, 78.1198],
  ["Tiruchirappalli", "Tamil Nadu", 10.7905, 78.7047],
  ["Salem", "Tamil Nadu", 11.6643, 78.146],
  ["Puducherry", "Puducherry", 11.9416, 79.8083],
  ["Bengaluru", "Karnataka", 12.9716, 77.5946],
  ["Mysuru", "Karnataka", 12.2958, 76.6394],
  ["Hyderabad", "Telangana", 17.385, 78.4867],
  ["Visakhapatnam", "Andhra Pradesh", 17.6868, 83.2185],
  ["Vijayawada", "Andhra Pradesh", 16.5062, 80.648],
  ["Kochi", "Kerala", 9.9312, 76.2673],
  ["Thiruvananthapuram", "Kerala", 8.5241, 76.9366],
  ["Mumbai", "Maharashtra", 19.076, 72.8777],
  ["Pune", "Maharashtra", 18.5204, 73.8567],
  ["Nagpur", "Maharashtra", 21.1458, 79.0882],
  ["Ahmedabad", "Gujarat", 23.0225, 72.5714],
  ["Surat", "Gujarat", 21.1702, 72.8311],
  ["Delhi", "Delhi", 28.6139, 77.209],
  ["Gurugram", "Haryana", 28.4595, 77.0266],
  ["Noida", "Uttar Pradesh", 28.5355, 77.391],
  ["Lucknow", "Uttar Pradesh", 26.8467, 80.9462],
  ["Jaipur", "Rajasthan", 26.9124, 75.7873],
  ["Chandigarh", "Chandigarh", 30.7333, 76.7794],
  ["Kolkata", "West Bengal", 22.5726, 88.3639],
  ["Bhubaneswar", "Odisha", 20.2961, 85.8245],
  ["Patna", "Bihar", 25.5941, 85.1376],
  ["Bhopal", "Madhya Pradesh", 23.2599, 77.4126],
  ["Indore", "Madhya Pradesh", 22.7196, 75.8577],
  ["Guwahati", "Assam", 26.1445, 91.7362],
];

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The nearest major city within 60 km, for when Google cannot name the place. */
export function nearestCity(lat: number, lng: number): PlaceDetails | null {
  let best: { city: string; state: string; km: number } | null = null;
  for (const [city, state, cLat, cLng] of CITIES) {
    const km = distanceKm(lat, lng, cLat, cLng);
    if (!best || km < best.km) best = { city, state, km };
  }
  return best && best.km <= 60 ? { city: best.city, state: best.state } : null;
}

export function validCoordinates(latitude?: string | null, longitude?: string | null): { lat: number; lng: number } | null {
  if (!latitude || !longitude) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Google Maps directions to a spot.
 *
 * The destination is the spot's exact map pin (latitude,longitude), so the
 * route ends at the pin and not at whatever Google guesses from the address
 * text. Well-known places carry a name to search for instead, and a spot
 * without a pin falls back to its address. The starting point is left to
 * Google Maps ("Your location"), which is more accurate than the browser.
 */
export function directionsUrl(spot: {
  latitude?: string | null;
  longitude?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  directionsQuery?: string | null;
}): string | null {
  const pin = validCoordinates(spot.latitude, spot.longitude);
  let destination: string | null = null;
  if (spot.directionsQuery?.trim()) destination = spot.directionsQuery.trim();
  else if (pin) destination = `${pin.lat},${pin.lng}`;
  else {
    const address = [spot.address, spot.city, spot.state].filter(Boolean).join(", ");
    destination = address || null;
  }
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
