import { useState } from "react";
import { useParams } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useGetBooking, getGetBookingQueryKey, useUpdateBooking, useGetSpot, getGetSpotQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { MapPin, Calendar, Clock, Car, CreditCard, AlertCircle, Navigation, QrCode, Gift, Mail, CircleCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { REWARDS_KEY, passUrl, useNotifications, type BookingExtras, type SpotExtras } from "@/lib/app-api";
import { NotificationItem } from "@/components/notifications/NotificationBell";
import { directionsUrl, openDirections } from "@/lib/places";
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

  const { data: messages } = useNotifications({ bookingId: id, enabled: !!id });

  // Directions from the driver's own position to the spot's map pin.
  const directions = spot ? directionsUrl(spot as typeof spot & SpotExtras) : null;
  const handleGetDirections = () => {
    if (!spot) return;
    openDirections(spot as typeof spot & SpotExtras, (title, description, bad) =>
      toast({ title, description, variant: bad ? "destructive" : undefined }),
    );
  };

  const [confirmCancel, setConfirmCancel] = useState(false);
  const handleCancel = () => {
    setConfirmCancel(false);
    updateBooking.mutate(
      { id, data: { status: 'cancelled' } },
      {
        onSuccess: (updatedBooking: any) => {
          const refunded = updatedBooking?.paymentStatus === "refunded";
          toast({
            title: "Booking Cancelled",
            description: refunded
              ? updatedBooking.paymentMode === "razorpay"
                ? `A full refund of ₹${updatedBooking.totalAmount} has been started. It reaches your account in 5–7 working days.`
                : "Your booking has been cancelled (demo payment, nothing was charged)."
              : updatedBooking?.refundError || "Your booking has been successfully cancelled.",
          });
          queryClient.setQueryData(getGetBookingQueryKey(id), updatedBooking);
          queryClient.invalidateQueries({ queryKey: REWARDS_KEY });
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

  const pass = booking as typeof booking & BookingExtras;
  const isLargeFacility = (spot as (typeof spot & SpotExtras) | undefined)?.isLargeFacility === true;
  const showPass = isLargeFacility && !!pass.verifyCode && booking.status !== "cancelled";

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
                {directions && (
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
              <div className="font-medium">
                {pass.isReward ? (
                  <span className="inline-flex items-center gap-1.5 text-green-600"><Gift className="h-4 w-4" /> Free parking reward</span>
                ) : (
                  <PaymentStatus booking={pass} />
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="bg-muted/20 p-4 rounded-lg flex justify-between items-center">
            <span className="font-medium">Total Amount</span>
            <span className="text-2xl font-extrabold text-primary">₹{booking.totalAmount}</span>
          </div>

          {showPass && (
            <div className="rounded-xl border-2 border-primary/30 p-5" data-testid="entry-pass">
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                {/* A QR code must be dark on white to scan, in light and dark mode alike. */}
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={passUrl(pass.verifyCode!)} size={168} level="M" title="Entry pass QR code" />
                </div>
                <div className="flex-1 space-y-3 text-center sm:text-left">
                  <h2 className="flex items-center justify-center gap-2 text-lg font-bold sm:justify-start">
                    <QrCode className="h-5 w-5 text-primary" /> Entry pass
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Show this QR code to the staff at the entrance. They scan it to check your booking.
                    Entry opens 15 minutes before your start time.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Your slot</div>
                      <div className="font-mono text-xl font-bold">{pass.slotLabel ?? "Any free slot"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Pass code</div>
                      <div className="font-mono text-xl font-bold">{pass.verifyCode}</div>
                    </div>
                  </div>
                  {pass.checkedInAt && (
                    <p className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                      <CircleCheck className="h-4 w-4" /> Entered at {format(new Date(pass.checkedInAt), 'h:mm a, MMM d')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {booking.status === 'confirmed' && (
            <div className="flex items-start gap-3 text-sm text-muted-foreground bg-primary/5 p-4 rounded-lg border border-primary/20">
              <AlertCircle className="h-5 w-5 text-primary shrink-0" />
              <p>
                Please arrive 5 minutes before your booking time.{" "}
                {showPass ? "Have the QR code above ready at the entrance." : "Have your vehicle number ready for verification at the entrance."}
              </p>
            </div>
          )}

          <div>
            <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
              <Mail className="h-4 w-4 text-primary" /> Messages for this booking
            </h2>
            {messages && messages.length > 0 ? (
              <div className="space-y-1 rounded-lg border p-2">
                {messages.map((item) => (
                  <div key={item.id} className="p-2">
                    <NotificationItem item={{ ...item, bookingId: null }} />
                    <p className="ml-7 mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {booking.status === 'cancelled'
                  ? "No messages: this booking was cancelled."
                  : "You will get a message here, and an email at your registered address, when your parking time starts and when it ends."}
              </p>
            )}
          </div>
        </CardContent>

        {booking.status === 'pending' || booking.status === 'confirmed' ? (
          <CardFooter className="bg-muted/10 pt-6 border-t flex justify-end gap-4">
            <Button variant="destructive" onClick={() => setConfirmCancel(true)} disabled={updateBooking.isPending}>
              Cancel Booking
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {pass.isReward
                ? "Your free parking reward will be given back to you."
                : new Date(booking.startTime).getTime() > Date.now()
                  ? `Your parking has not started yet, so you get a full refund of ₹${booking.totalAmount}.`
                  : "Your parking time has already started, so this booking cannot be refunded."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancel booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Payment state in plain words, with the Razorpay reference when there is one. */
function PaymentStatus({ booking }: { booking: { paymentStatus: string } & BookingExtras & { paymentId?: string | null } }) {
  const demo = booking.paymentMode === "simulated";
  switch (booking.paymentStatus) {
    case "paid":
      return (
        <span>
          <span className="text-green-600">Paid{demo ? " (demo, no money charged)" : ""}</span>
          {booking.paymentMode === "razorpay" && booking.paymentId && (
            <span className="block text-xs text-muted-foreground font-mono">{booking.paymentId}</span>
          )}
          {booking.refundError && <span className="block text-xs text-muted-foreground">{booking.refundError}</span>}
        </span>
      );
    case "refunded":
      return (
        <span>
          <span className="text-blue-600">Refunded{demo ? " (demo)" : ""}</span>
          {booking.refundId && booking.refundId !== "SIMULATED" && (
            <span className="block text-xs text-muted-foreground font-mono">{booking.refundId} · 5–7 working days</span>
          )}
        </span>
      );
    case "refund_failed":
      return (
        <span>
          <span className="text-destructive">Refund pending</span>
          <span className="block text-xs text-muted-foreground">{booking.refundError ?? "The refund will be retried by ParkEase."}</span>
        </span>
      );
    case "pending":
      return <span className="text-amber-600">Waiting for payment</span>;
    case "failed":
      return <span className="text-destructive">Payment not completed</span>;
    default:
      return <span className="capitalize">{booking.paymentStatus}</span>;
  }
}
