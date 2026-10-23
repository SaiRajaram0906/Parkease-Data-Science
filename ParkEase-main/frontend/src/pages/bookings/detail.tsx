import { useParams } from "wouter";
import { useGetBooking, getGetBookingQueryKey, useUpdateBooking, useGetSpot, getGetSpotQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { MapPin, Calendar, Clock, Car, CreditCard, AlertCircle, Navigation } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function BookingDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: booking, isLoading } = useGetBooking(id, {
    query: {
      enabled: !!id,
      queryKey: getGetBookingQueryKey(id),
    }
  });

  const updateBooking = useUpdateBooking();

  const { data: spot } = useGetSpot(booking?.spotId || 0, {
    query: {
      enabled: !!booking?.spotId,
      queryKey: getGetSpotQueryKey(booking?.spotId || 0),
    }
  });

  const handleGetDirections = () => {
    if (!spot?.latitude || !spot?.longitude) {
      toast({ title: "Location not available", description: "This spot doesn't have coordinates set.", variant: "destructive" });
      return;
    }

    // Simplified URL to let Google Maps app handle user location automatically
    const url = `https://www.google.com/maps/dir/?api=1&destination=${spot.latitude},${spot.longitude}&travelmode=driving`;
    window.open(url, "_blank");
  };

  const handleCancel = () => {
    updateBooking.mutate(
      { id, data: { status: 'cancelled' } },
      {
        onSuccess: (updatedBooking: any) => {
          toast({ title: "Booking Cancelled", description: "Your booking has been successfully cancelled." });
          queryClient.setQueryData(getGetBookingQueryKey(id), updatedBooking);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to cancel booking", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Skeleton className="h-8 w-1/3 mb-6" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!booking) return <div className="text-center py-20">Booking not found</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Booking Details</h1>
        <Badge variant="outline" className="text-sm py-1 font-mono">ID: #{booking.id}</Badge>
      </div>

      <Card className="overflow-hidden border-2 shadow-lg">
        <div className={`h-2 w-full ${booking.status === 'confirmed' ? 'bg-primary' : booking.status === 'cancelled' ? 'bg-destructive' : 'bg-muted-foreground'}`} />
        
        <CardHeader className="bg-muted/30 pb-8">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl mb-2">{booking.spotName}</CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center text-muted-foreground text-sm">
                  <MapPin className="h-4 w-4 mr-1" />
                  {spot?.address || "Loading location..."}
                </div>
                {spot?.latitude && spot?.longitude && (
                  <Button variant="ghost" size="sm" onClick={handleGetDirections} className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/10">
                    <Navigation className="h-3.5 w-3.5 mr-1" />
                    Get Directions
                  </Button>
                )}
              </div>
            </div>
            <Badge className={`text-sm px-4 py-1.5 ${booking.status === 'confirmed' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
              {booking.status.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-8 space-y-8">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground flex items-center">
                <Calendar className="h-4 w-4 mr-2" /> Start Time
              </div>
              <div className="font-bold text-lg">
                {format(new Date(booking.startTime), 'MMM d, yyyy • h:mm a')}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground flex items-center">
                <Clock className="h-4 w-4 mr-2" /> End Time
              </div>
              <div className="font-bold text-lg">
                {format(new Date(booking.endTime), 'MMM d, yyyy • h:mm a')}
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground flex items-center">
                <Car className="h-4 w-4 mr-2" /> Vehicle
              </div>
              <div className="font-medium">
                {booking.vehicleNumber} <span className="text-muted-foreground ml-1 capitalize">({booking.vehicleType})</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground flex items-center">
                <CreditCard className="h-4 w-4 mr-2" /> Payment Status
              </div>
              <div className="font-medium capitalize">
                {booking.paymentStatus}
              </div>
            </div>
          </div>

          <Separator />

          <div className="bg-muted/20 p-4 rounded-lg flex justify-between items-center">
            <span className="font-medium">Total Amount</span>
            <span className="text-2xl font-extrabold text-primary">₹{booking.totalAmount}</span>
          </div>

          {booking.status === 'confirmed' && (
            <div className="flex items-start gap-3 text-sm text-muted-foreground bg-primary/5 p-4 rounded-lg border border-primary/20">
              <AlertCircle className="h-5 w-5 text-primary shrink-0" />
              <p>Please arrive 5 minutes before your booking time. Have your vehicle number ready for verification at the entrance.</p>
            </div>
          )}
        </CardContent>

        {booking.status === 'pending' || booking.status === 'confirmed' ? (
          <CardFooter className="bg-muted/10 pt-6 border-t flex justify-end gap-4">
            <Button variant="destructive" onClick={handleCancel} disabled={updateBooking.isPending}>
              Cancel Booking
            </Button>
            {booking.status === 'pending' && (
              <Button>Pay Now</Button>
            )}
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}