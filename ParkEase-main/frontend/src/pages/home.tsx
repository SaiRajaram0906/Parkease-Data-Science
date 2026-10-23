import { Car, MapPin, Search, Calendar, ChevronRight, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListSpots } from "@workspace/api-client-react";
import { useState } from "react";
import { useGoogleMaps } from "@/context/GoogleMapsContext";

export default function Home() {
  const [, setLocation] = useLocation();
  const [city, setCity] = useState<string>("");
  const [vehicleType, setVehicleType] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);

  const { isLoaded } = useGoogleMaps();

  const { data: featuredSpots } = useListSpots({ available: "true" }, {
    query: {
      queryKey: ['spots', 'featured'],
      staleTime: 60000,
    } as any
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim() || !isLoaded) return;

    setIsSearching(true);
    const params = new URLSearchParams();
    if (vehicleType && vehicleType !== "both") params.append("vehicleType", vehicleType);

    // Use Google Geocoding to get coordinates for the search area
    try {
      const geocoder = new window.google.maps.Geocoder();
      const result = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode({ address: city, componentRestrictions: { country: 'IN' } }, (results, status) => {
          if (status === 'OK' && results) resolve(results);
          else reject(status);
        });
      });

      if (result[0]) {
        const { lat, lng } = result[0].geometry.location;
        params.append("lat", lat().toString());
        params.append("lng", lng().toString());
        params.append("search", city); // Keep name as fallback/display
      }
    } catch (error) {
      console.error("Geocoding failed:", error);
      params.append("search", city); // Fallback to text search
    }

    setIsSearching(false);
    setLocation(`/spots?${params.toString()}`);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-20 pb-32 lg:pt-32 lg:pb-48 overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 z-0">
          <img 
            src="/hero-bg.jpg" 
            alt="Premium parking facility" 
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-background/30 backdrop-blur-[2px]"></div>
        </div>

        <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground mb-6 leading-tight">
              Smart parking for <br className="hidden md:block"/>
              <span className="text-primary bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#4CAF50]">
                India's restless streets.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl font-medium">
              Find, book, and secure premium parking spaces by the hour or day. The confidence of Ola, the clarity of MakeMyTrip.
            </p>

            <div className="bg-card/90 backdrop-blur shadow-xl rounded-2xl p-4 md:p-6 border border-border/50 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search area (e.g. Tnagar, Koramangala)" 
                    className="h-12 pl-10 bg-background border-input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Select value={vehicleType} onValueChange={setVehicleType}>
                    <SelectTrigger className="h-12 bg-background border-input">
                      <Car className="mr-2 h-4 w-4 text-muted-foreground" />
                      <SelectValue placeholder="Vehicle Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">Car (4-Wheeler)</SelectItem>
                      <SelectItem value="bike">Bike (2-Wheeler)</SelectItem>
                      <SelectItem value="both">Any Vehicle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" size="lg" disabled={isSearching} className="h-12 px-8 text-base font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
                  <Search className="mr-2 h-5 w-5" />
                  {isSearching ? "Searching..." : "Find Spots"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Why choose ParkEase?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">We've reimagined urban parking for the modern Indian commuter.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
              <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
                <MapPin className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">Prime Locations</h3>
              <p className="text-muted-foreground leading-relaxed">
                Access verified parking spots in the heart of Mumbai, Delhi, Bengaluru, and more. No more circling the block.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Search className="w-32 h-32" />
              </div>
              <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6 relative z-10">
                <Search className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3 relative z-10">Transparent Pricing</h3>
              <p className="text-muted-foreground leading-relaxed relative z-10">
                Clear hourly and daily rates in INR (₹). What you see is what you pay. No hidden surcharges.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
              <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
                <Calendar className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">Guaranteed Booking</h3>
              <p className="text-muted-foreground leading-relaxed">
                Your spot is reserved the moment you book. Arrive with peace of mind, even during peak traffic hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Spots */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Featured Parking Spots</h2>
              <p className="text-muted-foreground">Top-rated spots available right now.</p>
            </div>
            <Link href="/spots">
              <Button variant="ghost" className="group">
                View all <ChevronRight className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(featuredSpots || []).slice(0, 4).map((spot) => (
              <Link key={spot.id} href={`/spots/${spot.id}`}>
                <div className="group bg-card rounded-xl border overflow-hidden hover:shadow-xl transition-all hover:-translate-y-1 cursor-pointer flex flex-col h-full">
                  <div className="relative h-48 bg-muted">
                    <img 
                      src={spot.imageUrl || "/spot-placeholder.jpg"} 
                      alt={spot.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm px-2 py-1 rounded text-xs font-semibold shadow-sm">
                      {spot.city}
                    </div>
                  </div>
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="font-bold text-lg mb-1 truncate">{spot.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{spot.address}</p>
                    
                    <div className="mt-auto flex items-center justify-between pt-4 border-t">
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Price</span>
                        <span className="font-bold text-lg text-primary">₹{spot.pricePerHour}<span className="text-xs text-muted-foreground font-normal">/hr</span></span>
                      </div>
                      <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">
                        {spot.vehicleType === 'both' ? 'Car & Bike' : spot.vehicleType === 'car' ? 'Car Only' : 'Bike Only'}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary text-primary-foreground py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/hero-bg.jpg')] opacity-10 mix-blend-overlay bg-cover bg-center"></div>
        <div className="container relative z-10 mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Have an empty parking spot?</h2>
          <p className="text-primary-foreground/80 text-lg md:text-xl mb-10 max-w-2xl mx-auto">
            Turn your unused space into passive income. Join thousands of spot owners in India's leading parking marketplace.
          </p>
          <Link href="/list-spot">
            <Button size="lg" variant="secondary" className="h-14 px-8 text-lg font-bold shadow-2xl hover:-translate-y-1 transition-transform">
              List Your Spot Today
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
