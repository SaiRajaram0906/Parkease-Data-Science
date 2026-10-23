import { GoogleMap, MarkerF, InfoWindowF } from "@react-google-maps/api";
import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { IndianRupee, MapPin } from "lucide-react";

interface Spot {
  id: number;
  name: string;
  address: string;
  pricePerHour: number;
  latitude: number;
  longitude: number;
  imageUrl?: string | null;
}

interface SpotMapProps {
  spots: Spot[];
  center: { lat: number; lng: number };
  searchMarker?: { lat: number; lng: number };
  onRegionChange?: (lat: number, lng: number) => void;
}

const mapContainerStyle = {
  width: "100%",
  height: "calc(100vh - 200px)",
  borderRadius: "1rem",
};

export function SpotMap({ spots, center, searchMarker, onRegionChange }: SpotMapProps) {
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  // Ensure map re-centers when the center prop changes (e.g. after a search)
  useEffect(() => {
    if (map && center) {
      map.panTo(center);
    }
  }, [map, center]);

  const handleSearchArea = () => {
    if (map && onRegionChange) {
      const center = map.getCenter();
      if (center) {
        onRegionChange(center.lat(), center.lng());
      }
    }
  };

  return (
    <div className="relative w-full h-full">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        zoom={15}
        center={center}
        onLoad={onLoad}
        options={{
          disableDefaultUI: false,
          clickableIcons: false,
          styles: [
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
        }}
      >
        {/* Search Marker (Target Location) */}
        {searchMarker && (
          <MarkerF 
            position={searchMarker}
            zIndex={100}
            label={{
              text: "Searched Location",
              className: "bg-background/90 text-[10px] font-bold px-2 py-0.5 rounded border shadow-sm -mt-12",
            }}
          />
        )}
        {spots.map((spot) => (
          <MarkerF
            key={spot.id}
            position={{ lat: spot.latitude, lng: spot.longitude }}
            onClick={() => setSelectedSpot(spot)}
            icon={window.google ? {
              path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
              fillColor: "#4CAF50",
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: "#ffffff",
              scale: 1.5,
              anchor: { x: 12, y: 22 } as any,
            } : undefined}
          />
        ))}

        {selectedSpot && (
          <InfoWindowF
            position={{ lat: selectedSpot.latitude, lng: selectedSpot.longitude }}
            onCloseClick={() => setSelectedSpot(null)}
          >
            <Card className="border-0 shadow-none w-64">
              <CardContent className="p-2">
                {selectedSpot.imageUrl && (
                  <img 
                    src={selectedSpot.imageUrl} 
                    alt={selectedSpot.name} 
                    className="w-full h-32 object-cover rounded-md mb-3"
                  />
                )}
                <h3 className="font-bold text-base mb-1 truncate">{selectedSpot.name}</h3>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{selectedSpot.address}</p>
                
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center font-bold text-primary">
                    <IndianRupee className="h-3 w-3 mr-0.5" />
                    {selectedSpot.pricePerHour}/hr
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Verified</Badge>
                </div>
                
                <Link href={`/spots/${selectedSpot.id}`}>
                  <Button size="sm" className="w-full h-8 text-xs">View Details</Button>
                </Link>
              </CardContent>
            </Card>
          </InfoWindowF>
        )}
      </GoogleMap>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <Button 
          variant="secondary" 
          className="shadow-xl border bg-background/95 backdrop-blur-sm hover:bg-background font-bold h-10 px-6 animate-in fade-in slide-in-from-top-4"
          onClick={handleSearchArea}
        >
          <MapPin className="h-4 w-4 mr-2 text-primary" />
          Search This Area
        </Button>
      </div>
    </div>
  );
}
