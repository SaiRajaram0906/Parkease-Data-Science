import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, Marker } from "@react-google-maps/api";
import { Loader2, LocateFixed, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGoogleMaps } from "@/context/GoogleMapsContext";
import { nearestCity, readGeocoderResult, type PlaceDetails } from "@/lib/places";

export interface PickedLocation extends PlaceDetails {
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  /** The current pin, if one has been set. */
  value: { lat: number; lng: number } | null;
  /**
   * Called whenever the pin moves: by searching, clicking the map, dragging
   * the pin or using the current location. Carries the coordinates and, when
   * they could be looked up, the address, city and state of that point.
   */
  onChange: (location: PickedLocation) => void;
  height?: number;
}

const CHENNAI = { lat: 13.0827, lng: 80.2707 };

/**
 * Map for choosing where a parking spot is.
 *
 * No pin is placed until the owner chooses a point, so a listing can no
 * longer be saved with the map's starting position as its location (which is
 * what used to send "Get Directions" to the wrong place).
 */
export function LocationPicker({ value, onChange, height = 350 }: LocationPickerProps) {
  const { isLoaded, loadError } = useGoogleMaps();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [message, setMessage] = useState("");
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsReady = isLoaded && !loadError;

  /** Looks up the address of a point and reports the new pin. */
  const place = useCallback(
    (lat: number, lng: number, known?: PlaceDetails) => {
      const fallback = () => onChange({ lat, lng, ...nearestCity(lat, lng), ...known });
      if (known?.city && known.state) {
        onChange({ lat, lng, ...known });
        return;
      }
      if (!mapsReady) {
        fallback();
        return;
      }
      new window.google.maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const details = readGeocoderResult(results[0]);
          const near = nearestCity(lat, lng);
          onChange({
            lat,
            lng,
            address: known?.address ?? details.address,
            city: details.city ?? near?.city,
            state: details.state ?? near?.state,
          });
        } else {
          fallback();
        }
      });
    },
    [mapsReady, onChange],
  );

  useEffect(() => {
    if (value && mapRef.current) mapRef.current.panTo(value);
  }, [value]);

  const search = () => {
    const text = query.trim();
    if (!text || !mapsReady) return;
    setBusy("search");
    setMessage("");
    new window.google.maps.Geocoder().geocode(
      { address: text, componentRestrictions: { country: "IN" } },
      (results, status) => {
        setBusy(null);
        if (status === "OK" && results?.[0]) {
          const { lat, lng } = results[0].geometry.location;
          place(lat(), lng(), readGeocoderResult(results[0]));
          mapRef.current?.setZoom(17);
        } else {
          setMessage(`Could not find "${text}". Try adding the area and city, or click the map.`);
        }
      },
    );
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setMessage("This browser cannot share its location. Search for the address or click the map.");
      return;
    }
    setBusy("locate");
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        place(pos.coords.latitude, pos.coords.longitude);
        mapRef.current?.setZoom(17);
      },
      () => {
        setBusy(null);
        setMessage("Location access was not allowed. Search for the address or click the map.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search for the address or place"
            placeholder="Search the address or place, e.g. Ranganathan Street, T. Nagar"
            className="h-11 pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // do not submit the listing form
                search();
              }
            }}
            disabled={!mapsReady}
          />
        </div>
        <Button type="button" variant="secondary" className="h-11" onClick={search} disabled={!mapsReady || busy !== null || !query.trim()}>
          {busy === "search" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Find on map
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={useMyLocation} disabled={busy !== null}>
          {busy === "locate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
          Use my location
        </Button>
      </div>

      {message && <p className="text-sm text-destructive" role="alert">{message}</p>}

      {mapsReady ? (
        <GoogleMap
          mapContainerStyle={{ width: "100%", height, borderRadius: "0.75rem", border: "1px solid hsl(var(--border))" }}
          center={value ?? CHENNAI}
          zoom={value ? 17 : 12}
          onLoad={(map) => {
            mapRef.current = map;
          }}
          onClick={(e) => e.latLng && place(e.latLng.lat(), e.latLng.lng())}
          options={{ zoomControl: true, streetViewControl: false, mapTypeControl: false, draggableCursor: "crosshair" }}
        >
          {value && (
            <Marker position={value} draggable onDragEnd={(e) => e.latLng && place(e.latLng.lat(), e.latLng.lng())} />
          )}
        </GoogleMap>
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground"
          style={{ height: 140 }}
        >
          {loadError
            ? "The map could not be loaded. Use “Use my location”, or type the latitude and longitude below."
            : "Loading map..."}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {!mapsReady
          ? "City and state are filled in from the latitude and longitude."
          : value
            ? "Drag the pin or click the map to adjust it. City, state, latitude and longitude are filled in from the pin."
            : "Search for the address, click the exact entrance on the map, or use your current location to place the pin."}
      </p>
    </div>
  );
}
