import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, MapPin, Filter, IndianRupee, Map as MapIcon, LayoutList, Loader2 } from "lucide-react";
import { useListSpots } from "@workspace/api-client-react";
import { SpotMap } from "@/components/map/SpotMap";
import { useGoogleMaps } from "@/context/GoogleMapsContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { RecommendationPanel } from "@/components/ds/RecommendationPanel";

export default function Spots() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1] || "");
  
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [vehicleType, setVehicleType] = useState(searchParams.get("vehicleType") || "all");
  
  const hasCoordinates = searchParams.get("lat") && searchParams.get("lng");
  const initialView = searchParams.get("view") === 'map' || hasCoordinates ? 'map' : 'list';
  const [viewMode, setViewMode] = useState<'list' | 'map'>(initialView as any);
  const [isSearching, setIsSearching] = useState(false);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const { isLoaded } = useGoogleMaps();

  // Get user's current location for map center
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          // Permission denied or error — keep null, will fall back to default
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  const fallbackCenter = { lat: 13.0827, lng: 80.2707 }; // Chennai fallback
  const defaultCenter = userLocation || fallbackCenter;
  const center = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : defaultCenter;
  
  const queryParams: any = {};
  if (search) queryParams.search = search;
  if (vehicleType !== "all") queryParams.vehicleType = vehicleType;
  if (lat) queryParams.lat = lat;
  if (lng) queryParams.lng = lng;

  const { data: spots, isLoading } = useListSpots(queryParams);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    
    if (!search.trim()) {
      params.delete("search");
      params.delete("lat");
      params.delete("lng");
      setLocation(`/spots?${params.toString()}`);
      return;
    }

    setIsSearching(true);
    try {
      const geocoder = new window.google.maps.Geocoder();
      const result = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode({ address: search, componentRestrictions: { country: 'IN' } }, (results, status) => {
          if (status === 'OK' && results) resolve(results);
          else reject(status);
        });
      });

      if (result[0]) {
        const { lat: locLat, lng: locLng } = result[0].geometry.location;
        params.set("lat", locLat().toString());
        params.set("lng", locLng().toString());
        params.set("search", search);
      }
    } catch (error) {
      console.error("Geocoding failed:", error);
      params.set("search", search);
      params.delete("lat");
      params.delete("lng");
    }
    setIsSearching(false);
    setLocation(`/spots?${params.toString()}`);
  };

  const toggleView = () => {
    const newMode = viewMode === 'list' ? 'map' : 'list';
    setViewMode(newMode);
    const params = new URLSearchParams(searchParams);
    params.set("view", newMode);
    setLocation(`/spots?${params.toString()}`, { replace: true });
  };

  const handleRegionChange = (newLat: number, newLng: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("lat", newLat.toString());
    params.set("lng", newLng.toString());
    setLocation(`/spots?${params.toString()}`);
  };

  const handleVehicleChange = (val: string) => {
    setVehicleType(val);
    const params = new URLSearchParams(searchParams);
    if (val !== "all") params.set("vehicleType", val);
    else params.delete("vehicleType");
    setLocation(`/spots?${params.toString()}`, { replace: true });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex justify-between items-center w-full md:w-auto gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Find Parking</h1>
            <p className="text-muted-foreground mt-1">
              {lat && lng ? `Showing spots within 500m of your search` : "Search for areas, landmarks, or addresses."}
            </p>
          </div>
          <Button 
            variant={viewMode === 'map' ? 'default' : 'outline'} 
            size="sm" 
            onClick={toggleView} 
            className="md:hidden font-bold shadow-sm"
          >
            {viewMode === 'list' ? (
              <><MapIcon className="h-4 w-4 mr-2" /> Map View</>
            ) : (
              <><LayoutList className="h-4 w-4 mr-2" /> List View</>
            )}
          </Button>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <Button 
            variant={viewMode === 'map' ? 'default' : 'outline'} 
            onClick={toggleView} 
            className="hidden md:flex h-10 font-bold px-4"
          >
            {viewMode === 'list' ? (
              <><MapIcon className="h-4 w-4 mr-2" /> Switch to Map</>
            ) : (
              <><LayoutList className="h-4 w-4 mr-2" /> Switch to List</>
            )}
          </Button>
          <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search area..." 
                className="pl-10 h-10 w-full"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={isSearching} className="h-10">
              {isSearching ? "..." : "Search"}
            </Button>
          </form>
          
          <Select value={vehicleType} onValueChange={handleVehicleChange}>
            <SelectTrigger className="w-full sm:w-[150px] h-10">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Vehicle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vehicles</SelectItem>
              <SelectItem value="car">Car</SelectItem>
              <SelectItem value="bike">Bike</SelectItem>
              <SelectItem value="both">Any</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Data Science: ranked recommendations above the regular results */}
      <RecommendationPanel
        origin={lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : userLocation}
        originLabel={lat && lng ? (search ? `"${search}"` : "your search") : "your location"}
        vehicleType={vehicleType}
      />

      <h2 className="mb-4 text-xl font-bold tracking-tight">
        {lat && lng ? "Spots within 500 m" : "All spots"}
      </h2>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-48 w-full rounded-none" />
              <CardContent className="p-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : spots?.length === 0 && viewMode === 'list' ? (
        <div className="text-center py-20 bg-muted/30 rounded-lg border border-dashed">
          <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-1">No spots found</h3>
          <p className="text-muted-foreground">Try adjusting your filters to find more parking spaces.</p>
        </div>
      ) : viewMode === 'map' ? (
        <div className="animate-in fade-in duration-500 min-h-[400px]">
          {isLoaded ? (
            <SpotMap 
              spots={spots?.map(s => ({
                id: s.id,
                name: s.name,
                address: s.address,
                pricePerHour: Number(s.pricePerHour),
                latitude: Number(s.latitude),
                longitude: Number(s.longitude),
                imageUrl: s.imageUrl
              })) || []} 
              center={center}
              searchMarker={lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined}
              onRegionChange={handleRegionChange}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-muted rounded-xl">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in duration-500">
          {spots?.map((spot, i) => (
            <Link key={spot.id} href={`/spots/${spot.id}`} className="block min-w-0">
              <Card className="overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1 cursor-pointer h-full flex flex-col group border-border/50">
                <div className="relative h-48 bg-muted">
                  <img 
                    src={spot.imageUrl || "/spot-placeholder.jpg"} 
                    alt={spot.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute top-3 left-3 flex gap-2">
                    <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm hover:bg-background">
                      {spot.city}
                    </Badge>
                    {spot.availableSlots > 0 ? (
                      <Badge className="bg-primary/90 hover:bg-primary backdrop-blur-sm text-primary-foreground">
                        {spot.availableSlots} spots left
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="backdrop-blur-sm">
                        Full
                      </Badge>
                    )}
                    {(spot as { isLargeFacility?: boolean }).isLargeFacility && (
                      <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm hover:bg-background">
                        QR entry
                      </Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-5 flex-1">
                  <h3 className="font-bold text-lg mb-1 truncate">{spot.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{spot.address}</p>
                  
                  <div className="flex items-center gap-4 text-sm mt-auto">
                    <div className="flex items-center text-muted-foreground">
                      <IndianRupee className="h-3.5 w-3.5 mr-1" />
                      <span className="font-semibold text-foreground">{spot.pricePerHour}</span>/hr
                    </div>
                    <div className="flex items-center text-muted-foreground">
                      <Filter className="h-3.5 w-3.5 mr-1" />
                      <span className="capitalize">{spot.vehicleType}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}