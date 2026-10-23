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

type DirectionsSpot = {
  latitude?: string | null;
  longitude?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  directionsQuery?: string | null;
};

/**
 * Where the route should end: the spot's exact map pin (latitude,longitude).
 * Only the well-known demo places, whose pins are approximate, are searched
 * by name instead; a spot without a pin falls back to its address.
 */
export function directionsDestination(spot: DirectionsSpot): string | null {
  const pin = validCoordinates(spot.latitude, spot.longitude);
  if (spot.directionsQuery?.trim()) return spot.directionsQuery.trim();
  if (pin) return `${pin.lat},${pin.lng}`;
  const address = [spot.address, spot.city, spot.state].filter(Boolean).join(", ");
  return address || null;
}

/** Google Maps directions link. `origin` is "lat,lng" of the driver, when known. */
export function directionsUrl(spot: DirectionsSpot, origin?: string): string | null {
  const destination = directionsDestination(spot);
  if (!destination) return null;
  const params = new URLSearchParams({ api: "1", destination, travelmode: "driving" });
  if (origin) params.set("origin", origin);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Opens Google Maps directions from the driver's current position (GPS on a
 * phone) to the spot. Both ends are sent as latitude,longitude, so Google
 * does not have to guess either of them.
 *
 * The new tab is opened straight away, while the click still counts as the
 * user's action (otherwise browsers block it as a pop-up), and is pointed at
 * the route once the position is known. If the position cannot be read, the
 * route starts from Google's own "Your location".
 */
export function openDirections(
  spot: DirectionsSpot,
  notify: (title: string, description: string, bad?: boolean) => void,
): void {
  const fallback = directionsUrl(spot);
  if (!fallback) {
    notify("Location not available", "This spot has no location set.", true);
    return;
  }
  const tab = window.open("", "_blank");
  const go = (url: string) => {
    if (tab && !tab.closed) tab.location.href = url;
    else window.location.href = url;
  };
  if (!("geolocation" in navigator) || !window.isSecureContext) {
    notify("Using Google's location", "This page cannot read your position (it needs https or localhost), so Google Maps will find you.");
    go(fallback);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const origin = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
      if (accuracy > 1000) {
        notify("Your position is approximate", `This device knows your location only to about ${(accuracy / 1000).toFixed(1)} km. On a phone with GPS it is exact.`);
      }
      go(directionsUrl(spot, origin)!);
    },
    () => {
      notify("Location permission needed", "Allow location access for exact directions. Opening Google Maps with its own location instead.");
      go(fallback);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}
