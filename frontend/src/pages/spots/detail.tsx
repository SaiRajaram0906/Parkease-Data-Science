import { useParams, useLocation } from "wouter";
import { 
  useGetSpot, 
  useGetSpotReviews, 
  getGetSpotQueryKey, 
  getGetSpotReviewsQueryKey,
  useCreateReview,
  useUpdateSpot,
  useDeleteSpot
} from "@workspace/api-client-react";
import { MapPin, Star, CheckCircle, ShieldCheck, Trash2, Loader2, CalendarCheck, Navigation, QrCode, MapPinned } from "lucide-react";
import { GoogleMap, Marker } from "@react-google-maps/api";
import { useGoogleMaps } from "@/context/GoogleMapsContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import BookingModal from "@/components/booking/BookingModal";
import { useAuth } from "@/context/AuthContext";
import { AvailabilityForecast } from "@/components/ds/AvailabilityForecast";
import { EditLocationDialog } from "@/components/map/EditLocationDialog";
import { directionsUrl, validCoordinates } from "@/lib/places";
import type { SpotExtras } from "@/lib/app-api";

export default function SpotDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = Number(params.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [editLocationOpen, setEditLocationOpen] = useState(false);
  
  const { data: spot, isLoading } = useGetSpot(id, {
    query: {
      enabled: !!id,
      queryKey: getGetSpotQueryKey(id),
    }
  });

  const { data: reviews } = useGetSpotReviews(id, {
    query: { 
      enabled: !!id,
      queryKey: getGetSpotReviewsQueryKey(id),
    }
  });

  const createReview = useCreateReview();
  const updateSpot = useUpdateSpot();
  const deleteSpot = useDeleteSpot();

  const submitReview = () => {
    if (!reviewComment.trim()) return;
    createReview.mutate({
      data: {
        spotId: id,
        userId: user?.id ?? null,
        userName: user?.name ?? "Anonymous",
        rating: reviewRating,
        comment: reviewComment
      }
    }, {
      onSuccess: () => {
        toast({ title: "Review added", description: "Thanks for your feedback!" });
        setReviewComment("");
        queryClient.invalidateQueries({ queryKey: getGetSpotReviewsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(id) });
      }
    });
  };

  const toggleActive = () => {
    if (!spot) return;
    updateSpot.mutate({
      id,
      data: { isActive: !spot.isActive }
    }, {
      onSuccess: () => {
        toast({ title: "Spot Updated", description: `Spot is now ${!spot.isActive ? 'active' : 'inactive'}.` });
        queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(id) });
      }
    });
  };

  const removeSpot = () => {
    deleteSpot.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Spot Deleted", description: "The spot has been removed." });
        // Owners have no Find Parking page; they go back to their dashboard.
        setLocation(user?.role === "admin" ? "/spots" : "/dashboard");
      }
    });
  };

  const handleBookNow = () => {
    if (!isAuthenticated) {
      toast({ title: "Login required", description: "Please login to book a parking spot.", variant: "destructive" });
      setLocation("/login");
      return;
    }
    setBookingModalOpen(true);
  };

  // Directions end at the spot's exact map pin (see lib/places). The starting
  // point is left to Google Maps, which knows the driver's position better
  // than the browser does.
  const handleGetDirections = () => {
    const url = spot ? directionsUrl(spot as typeof spot & SpotExtras) : null;
    if (!url) {
      toast({ title: "Location not available", description: "This spot has no location set.", variant: "destructive" });
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 animate-pulse">
        <Skeleton className="h-64 w-full rounded-xl mb-8" />
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full mt-6" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!spot) return <div className="container mx-auto py-20 text-center text-xl font-medium">Spot not found</div>;

  const extras = spot as typeof spot & SpotExtras;
  const canManage = user?.role === "admin" || (!!user && spot.ownerId === user.id);
  // Drivers (and admins) book parking. Owner accounts list it.
  const canBook = !isAuthenticated || user?.role === "driver" || user?.role === "admin";
  const hasPin = validCoordinates(spot.latitude, spot.longitude) !== null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header Image */}
      <div className="relative h-[30vh] md:h-[50vh] rounded-2xl overflow-hidden mb-8 group">
        <img 
          src={spot.imageUrl || "https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=1200&q=80"} 
          alt={spot.name} 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end">
          <div className="text-white">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border-none">
                {spot.city}, {spot.state}
              </Badge>
              {extras.isLargeFacility && (
                <Badge className="border-none bg-primary text-primary-foreground hover:bg-primary">
                  <QrCode className="mr-1 h-3.5 w-3.5" /> Large facility · QR entry
                </Badge>
              )}
            </div>
            <h1 className="text-3xl md:text-5xl font-bold text-white mb-2">{spot.name}</h1>
            <p className="flex items-center text-white/80">
              <MapPin className="h-4 w-4 mr-1" />
              {spot.address}
            </p>
          </div>
          {/* Only the owner of this spot, or an admin, may change it. */}
          {canManage && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditLocationOpen(true)} className="bg-white/20 hover:bg-white/30 text-white border-none backdrop-blur-md">
                <MapPinned className="mr-1.5 h-4 w-4" /> Edit location
              </Button>
              <Button variant="secondary" size="sm" onClick={toggleActive} className="bg-white/20 hover:bg-white/30 text-white border-none backdrop-blur-md">
                {spot.isActive ? "Deactivate" : "Activate"}
              </Button>
              <Button variant="destructive" size="sm" onClick={removeSpot} className="backdrop-blur-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-10">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-8">
          <div>
            <h2 className="text-2xl font-bold mb-4">About this spot</h2>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {spot.description || "A secure parking spot conveniently located for easy access."}
            </p>
          </div>

          <Separator />

          {/* Data Science: actual availability next to the model's prediction */}
          <AvailabilityForecast spotId={id} />

          <Separator />

          <div>
             <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">Location</h2>
              {(hasPin || extras.directionsQuery || spot.address) && (
                <Button variant="outline" size="sm" onClick={handleGetDirections} className="flex items-center gap-2">
                  <Navigation className="h-4 w-4" />
                  Get Directions
                </Button>
              )}
            </div>
            <div className="rounded-xl overflow-hidden border-2 border-muted shadow-inner h-[300px]">
              <SpotMap 
                lat={parseFloat(spot.latitude ?? "")} 
                lng={parseFloat(spot.longitude ?? "")} 
                address={`${spot.address}, ${spot.city}, ${spot.state}`}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground flex items-center">
              <MapPin className="h-4 w-4 mr-1 text-primary" />
              {spot.address}, {spot.city}, {spot.state}
            </p>
          </div>

          <Separator />

          <div>
            <h2 className="text-2xl font-bold mb-4">Features & Amenities</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <CheckCircle className="h-5 w-5 text-primary" />
                <span className="font-medium capitalize">{spot.vehicleType === "both" ? "Car & Bike" : spot.vehicleType} Parking</span>
              </div>
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <span className="font-medium">Secure</span>
              </div>
              {spot.amenities?.split(',').map(amenity => (
                <div key={amenity} className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span className="font-medium capitalize">{amenity.trim()}</span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Reviews Section */}
          <div>
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold">Reviews</h2>
              {spot.rating && (
                <div className="flex items-center text-lg font-semibold bg-primary/10 text-primary px-3 py-1 rounded-full">
                  <Star className="h-5 w-5 fill-current mr-1" />
                  {Number(spot.rating).toFixed(1)} ({spot.totalReviews})
                </div>
              )}
            </div>

            {isAuthenticated && canBook && (
              <div className="bg-card border rounded-xl p-5 mb-6">
                <h3 className="font-bold mb-3">Write a Review</h3>
                <div className="flex gap-2 mb-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star 
                      key={star} 
                      className={`h-6 w-6 cursor-pointer transition-colors ${star <= reviewRating ? "fill-primary text-primary" : "text-muted-foreground"}`} 
                      onClick={() => setReviewRating(star)}
                    />
                  ))}
                </div>
                <Textarea 
                  placeholder="How was your parking experience?" 
                  value={reviewComment} 
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="mb-3"
                />
                <Button onClick={submitReview} disabled={!reviewComment.trim() || createReview.isPending}>
                  {createReview.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Submit Review
                </Button>
              </div>
            )}

            {reviews && reviews.length > 0 ? (
              <div className="space-y-6">
                {reviews.map(review => (
                  <div key={review.id} className="bg-card border rounded-xl p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold">{review.userName || "User"}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(review.createdAt), 'MMM d, yyyy')}</p>
                      </div>
                      <div className="flex text-yellow-500">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-4 w-4 ${i < review.rating ? "fill-current" : "text-muted opacity-30"}`} />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-foreground/80">{review.comment}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground bg-muted/20 p-6 rounded-xl text-center">No reviews yet for this spot.</p>
            )}
          </div>
        </div>

        {/* Booking Sidebar */}
        <div className="relative">
          <div className="sticky top-24 bg-card border shadow-xl rounded-2xl p-6">
            <div className="flex justify-between items-start mb-6 pb-6 border-b">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Price</p>
                <div className="flex items-baseline text-primary">
                  <span className="text-3xl font-extrabold">₹{spot.pricePerHour}</span>
                  <span className="text-muted-foreground text-sm font-medium ml-1">/hour</span>
                </div>
                {spot.pricePerDay && (
                  <p className="text-xs text-muted-foreground mt-1">or ₹{spot.pricePerDay}/day</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-muted-foreground mb-1">Availability</p>
                <Badge variant={spot.availableSlots > 0 ? "default" : "destructive"} className="text-sm px-3 py-1">
                  {spot.availableSlots > 0 ? `${spot.availableSlots} slots left` : 'Full'}
                </Badge>
              </div>
            </div>

            <div className="space-y-3 mb-6 text-sm">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">Vehicle Type</span>
                <span className="font-medium capitalize">{spot.vehicleType === 'both' ? 'Car & Bike' : spot.vehicleType}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">Total Slots</span>
                <span className="font-medium">{spot.totalSlots}</span>
              </div>
              {spot.rating && (
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Rating</span>
                  <span className="font-medium flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    {Number(spot.rating).toFixed(1)} ({spot.totalReviews})
                  </span>
                </div>
              )}
            </div>

            {extras.isLargeFacility && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
                <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                A numbered slot is kept for every booking. Show your QR code at the entrance.
              </p>
            )}
            {canBook ? (
              <>
                <Button 
                  size="lg" 
                  className="w-full text-base font-bold shadow-lg" 
                  disabled={spot.availableSlots === 0}
                  onClick={handleBookNow}
                >
                  <CalendarCheck className="h-5 w-5 mr-2" />
                  {spot.availableSlots > 0 ? "Book Now" : "Currently Unavailable"}
                </Button>
                <p className="text-center text-xs text-muted-foreground mt-3">
                  {isAuthenticated ? "Booking confirmed instantly. Pay securely." : "Login required to book."}
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-muted/40 p-3 text-center text-sm text-muted-foreground">
                {canManage
                  ? "This is your listing. Drivers book it from Find Parking."
                  : "Owner accounts list parking. Sign in with a driver account to book a spot."}
              </p>
            )}
          </div>
        </div>
      </div>

      {canManage && editLocationOpen && (
        <EditLocationDialog spot={spot} open={editLocationOpen} onClose={() => setEditLocationOpen(false)} />
      )}

      {/* Booking Modal */}
      {spot && canBook && (
        <BookingModal
          spot={spot as any}
          open={bookingModalOpen}
          onClose={() => setBookingModalOpen(false)}
        />
      )}
    </div>
  );
}

function SpotMap({ lat, lng, address }: { lat: number; lng: number; address?: string }) {
  const { isLoaded } = useGoogleMaps();
  const [center, setCenter] = useState({ lat: 19.0760, lng: 72.8777 });

  useEffect(() => {
    const isValidCoord = lat && lng && !isNaN(lat) && !isNaN(lng);
    
    if (isLoaded && address && !isValidCoord) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          setCenter({
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng()
          });
        }
      });
    } else if (isValidCoord) {
      setCenter({ lat, lng });
    }
  }, [lat, lng, address, isLoaded]);

  if (!isLoaded) return <div className="h-full w-full bg-muted animate-pulse flex items-center justify-center">Loading Map...</div>;

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '100%' }}
      center={center}
      zoom={15}
      options={{
        disableDefaultUI: true,
        zoomControl: true,
      }}
    >
      <Marker position={center} />
    </GoogleMap>
  );
}
