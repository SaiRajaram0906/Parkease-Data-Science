import { useEffect, useMemo, useState } from "react";
import { getListBookingsQueryKey, getGetSpotQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, ShieldCheck, CheckCircle, Car, Bike, Gift, QrCode, Calendar as CalendarIcon, Clock, TriangleAlert, Info } from "lucide-react";
import { format, setHours, setMinutes, startOfToday, isBefore, isSameDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  REWARDS_KEY,
  abandonPayment,
  createBookingDirect,
  startCheckout,
  useRewards,
  usePaymentConfig,
  verifyPayment,
  type BookingRequest,
} from "@/lib/app-api";
import { openRazorpay } from "@/lib/razorpay";
import { ApiRequestError } from "@/lib/auth-api";

interface Spot {
  id: number;
  name: string;
  address: string;
  city: string;
  pricePerHour: string;
  pricePerDay: string | null | undefined;
  vehicleType: string;
  availableSlots: number;
  isLargeFacility?: boolean;
}

interface BookingModalProps {
  spot: Spot;
  open: boolean;
  onClose: () => void;
}

type Step = "details" | "payment" | "success";

const DEMO_METHODS = [
  { id: "upi", label: "UPI", icon: "🏦", desc: "Pay via UPI ID or QR code" },
  { id: "card", label: "Credit / Debit Card", icon: "💳", desc: "Visa, Mastercard, RuPay" },
  { id: "netbanking", label: "Net Banking", icon: "🏛", desc: "All major banks supported" },
  { id: "wallet", label: "Paytm / PhonePe", icon: "📱", desc: "Mobile wallets" },
];

/** "10:00 AM"; hour 24 is midnight at the end of the chosen day. */
function hourLabel(hour: number): string {
  const label = format(setHours(startOfToday(), hour % 24), "hh:00 a");
  return hour === 24 ? `${label} (midnight)` : label;
}

const BRAND_GREEN = "#65a30d";

export default function BookingModal({ spot, open, onClose }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const payments = usePaymentConfig();
  const realPayments = payments.data?.mode === "razorpay";

  const [step, setStep] = useState<Step>("details");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleType, setVehicleType] = useState(spot.vehicleType === "both" ? "car" : spot.vehicleType);

  const [date, setDate] = useState<Date>(startOfToday());
  const [startHour, setStartHour] = useState(10);
  const [endHour, setEndHour] = useState(11);
  const [timingAlert, setTimingAlert] = useState<string | null>(null);

  const [selectedPayment, setSelectedPayment] = useState("upi");
  const [isProcessing, setIsProcessing] = useState(false);
  // While Razorpay's own window is open, the booking window steps aside: a
  // modal dialog blocks clicks everywhere outside itself, Razorpay included.
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [result, setResult] = useState<{ id: number; amount: string; free: boolean; slot: string | null; demo: boolean } | null>(null);

  // Free-parking reward (one free booking for every ten paid ones).
  const rewards = useRewards(open && !!user);
  const rewardsAvailable = rewards.data?.available ?? 0;
  const [useReward, setUseReward] = useState(false);
  const free = useReward && rewardsAvailable > 0;

  // Start at the next full hour when the window opens today.
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const next = Math.min(now.getHours() + 1, 23);
    setDate(startOfToday());
    setStartHour(now.getHours() >= 23 ? 23 : Math.max(next, 6));
    setEndHour(now.getHours() >= 23 ? 24 : Math.max(next, 6) + 1);
  }, [open]);

  const startTime = setMinutes(setHours(date, startHour), 0);
  const endTime = setMinutes(setHours(date, endHour), 0); // hour 24 rolls over to the next midnight
  const durationHours = (endTime.getTime() - startTime.getTime()) / 3_600_000;
  const currentHour = new Date().getHours();
  const isToday = isSameDay(date, new Date());

  /** Why the chosen times cannot be booked, or null when they are fine. */
  const timingProblem = useMemo(() => {
    if (endHour <= startHour) {
      return `The end time (${hourLabel(endHour)}) must be after the start time (${hourLabel(startHour)}). Choose a later end time or an earlier start time.`;
    }
    if (isToday && startHour < currentHour) {
      return `${hourLabel(startHour)} has already passed today. Choose a start time from ${hourLabel(currentHour)} onwards, or pick another day.`;
    }
    return null;
  }, [startHour, endHour, isToday, currentHour]);

  const fullPrice = timingProblem ? null : (parseFloat(spot.pricePerHour) * durationHours).toFixed(2);
  const total = fullPrice === null ? null : free ? "0.00" : fullPrice;

  // Moving the start past the end simply moves the end along (one hour
  // later); choosing an end that is not after the start shows the pop-up.
  const changeStart = (hour: number) => {
    setStartHour(hour);
    if (endHour <= hour) setEndHour(Math.min(hour + 1, 24));
  };
  const changeEnd = (hour: number) => {
    setEndHour(hour);
    if (hour <= startHour) {
      setTimingAlert(`The end time ${hourLabel(hour)} is not after the start time ${hourLabel(startHour)}. The end time must be later than the start time.`);
    }
  };

  const request = (): BookingRequest => ({
    spotId: spot.id,
    vehicleNumber: vehicleNumber.trim().toUpperCase(),
    vehicleType,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationHours: durationHours.toString(),
    totalAmount: total ?? "0",
    notes: realPayments ? "Razorpay" : `Demo payment via ${selectedPayment}`,
    ...(free ? { useReward: true } : {}),
  });

  const finished = (booking: { id: number; totalAmount: string; slotLabel?: string | null }, demo: boolean) => {
    setResult({ id: booking.id, amount: booking.totalAmount, free, slot: booking.slotLabel ?? null, demo });
    queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(spot.id) });
    queryClient.invalidateQueries({ queryKey: REWARDS_KEY });
    setStep("success");
  };

  const failed = (err: unknown) => {
    const message = err instanceof Error ? err.message : "Could not complete your booking. Please try again.";
    if (/already booked/i.test(message)) {
      toast({ title: "Slot unavailable", description: "The chosen time is already booked. Please choose a different time.", variant: "destructive" });
      setStep("details");
    } else {
      toast({ title: "Booking failed", description: message, variant: "destructive" });
    }
  };

  /** Free reward bookings and demo payments: no money moves. */
  const bookWithoutGateway = async () => {
    setIsProcessing(true);
    try {
      if (!free) await new Promise((r) => setTimeout(r, 1200));
      finished(await createBookingDirect(request()), !free);
    } catch (err) {
      failed(err);
      if (err instanceof ApiRequestError && /checkout/i.test(err.message)) {
        // The server has real payments switched on; reload its settings.
        void payments.refetch();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  /** Real payment through Razorpay Checkout (UPI, cards, net banking, wallets). */
  const payWithRazorpay = async () => {
    setIsProcessing(true);
    let bookingId: number | null = null;
    try {
      const order = await startCheckout(request());
      bookingId = order.bookingId;
      setGatewayOpen(true);
      const outcome = await openRazorpay(order, BRAND_GREEN);
      setGatewayOpen(false);
      if (outcome.status === "paid") {
        finished(await verifyPayment({ bookingId, ...outcome.response }), false);
        return;
      }
      const reason = outcome.status === "failed" ? outcome.reason : "Payment window closed before paying.";
      await abandonPayment(bookingId, reason);
      toast({
        title: outcome.status === "failed" ? "Payment failed" : "Payment cancelled",
        description: `${reason} No money was taken and the slot was released.`,
        variant: "destructive",
      });
    } catch (err) {
      if (bookingId) await abandonPayment(bookingId, "Checkout error").catch(() => undefined);
      failed(err);
    } finally {
      setGatewayOpen(false);
      setIsProcessing(false);
    }
  };

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timingProblem) {
      setTimingAlert(timingProblem);
      return;
    }
    if (!vehicleNumber.trim()) {
      toast({ title: "Vehicle number required", description: "Enter the number plate of the vehicle you will park.", variant: "destructive" });
      return;
    }
    if (isBefore(endTime, new Date())) {
      setTimingAlert("This time has already passed. Please choose a later time.");
      return;
    }
    if (free) {
      void bookWithoutGateway();
      return;
    }
    setStep("payment");
  };

  const handleClose = () => {
    if (isProcessing) return;
    setStep("details");
    setVehicleNumber("");
    setUseReward(false);
    setResult(null);
    onClose();
  };

  const goToBooking = () => {
    const id = result?.id;
    handleClose();
    if (id) setLocation(`/bookings/${id}`);
  };

  const selectClass =
    "h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <Dialog open={open && !gatewayOpen} onOpenChange={(next) => !next && handleClose()}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md p-0 overflow-hidden max-h-[92dvh] overflow-y-auto rounded-xl">
          {/* Header */}
          <div className="bg-[#1a1a2e] px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
              <span className="text-[#4ade80] text-xs font-semibold uppercase tracking-wider">Secure Checkout</span>
            </div>
            <DialogTitle className="text-white text-xl font-bold pr-6">{spot.name}</DialogTitle>
            <p className="text-white/60 text-sm">{spot.address}, {spot.city}</p>
          </div>

          {/* Step: Details */}
          {step === "details" && (
            <form onSubmit={handleDetailsSubmit} className="p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-xl text-sm">
                <div>
                  <p className="text-muted-foreground mb-0.5">Price per hour</p>
                  <p className="font-bold text-lg">₹{spot.pricePerHour}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Available slots</p>
                  <p className="font-bold text-lg">{spot.availableSlots}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">Select Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full h-11 justify-start text-left font-normal", !date && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 shadow-2xl border-2" align="start">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={(d) => d && setDate(d)}
                        initialFocus
                        disabled={(day) => isBefore(day, startOfToday())}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Native lists: they scroll with the mouse wheel and touch,
                    and open the phone's own time picker on mobile. */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start-time" className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> Start Time
                    </Label>
                    <select id="start-time" className={selectClass} value={startHour} onChange={(e) => changeStart(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h} disabled={isToday && h < currentHour}>
                          {hourLabel(h)}{isToday && h < currentHour ? " (passed)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="end-time" className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> End Time
                    </Label>
                    <select id="end-time" className={selectClass} value={endHour} onChange={(e) => changeEnd(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>{hourLabel(h)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {timingProblem && (
                  <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {timingProblem}
                  </p>
                )}
              </div>

              {spot.vehicleType === "both" && (
                <div>
                  <Label className="text-sm font-medium">Vehicle type</Label>
                  <div className="grid grid-cols-2 gap-3 mt-1.5">
                    {["car", "bike"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setVehicleType(type)}
                        aria-pressed={vehicleType === type}
                        className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                          vehicleType === type ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {type === "car" ? <Car className="w-4 h-4" /> : <Bike className="w-4 h-4" />}
                        <span className="font-medium capitalize">{type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="vehicle-number" className="text-sm font-medium">Vehicle number</Label>
                <Input
                  id="vehicle-number"
                  placeholder="e.g. TN 09 AB 1234"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  className="mt-1.5 h-11 font-mono tracking-wider uppercase"
                  autoCapitalize="characters"
                  required
                />
              </div>

              <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Start time</span>
                  <span className="font-medium text-right">{format(startTime, "hh:mm a, dd MMM")}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">End time</span>
                  <span className="font-medium text-right">{format(endTime, "hh:mm a, dd MMM")}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">{timingProblem ? "—" : `${durationHours} hour${durationHours === 1 ? "" : "s"}`}</span>
                </div>
                {free && fullPrice && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Free parking reward</span>
                    <span className="font-medium text-green-600">- ₹{fullPrice}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="font-semibold">Total amount</span>
                  <span className="font-bold text-primary text-base">{total === null ? "—" : `₹${total}`}</span>
                </div>
              </div>

              {rewardsAvailable > 0 && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors ${free ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Gift className="h-4 w-4 text-primary" /> Use a free parking reward
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      You have {rewardsAvailable} free booking{rewardsAvailable > 1 ? "s" : ""}. This booking will cost ₹0.
                    </span>
                  </span>
                </label>
              )}

              {spot.isLargeFacility && (
                <p className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                  <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Large parking facility: a numbered slot is kept for you and you get a QR code to show at the entrance.
                </p>
              )}

              <Button type="submit" className="w-full h-11 font-semibold" disabled={isProcessing}>
                {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {free ? "Confirm Free Booking" : "Proceed to Payment"}
              </Button>
            </form>
          )}

          {/* Step: Payment */}
          {step === "payment" && (
            <div className="p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between text-sm">
                <button onClick={() => setStep("details")} disabled={isProcessing} className="text-muted-foreground hover:text-foreground transition-colors">
                  Back
                </button>
                <Badge variant="outline" className="text-primary border-primary/30 font-bold">₹{total} due</Badge>
              </div>

              <div className="bg-muted/30 rounded-xl p-4 text-sm space-y-1.5">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Parking</span><span className="font-medium text-right">{format(startTime, "dd MMM, hh:mm a")} – {format(endTime, "hh:mm a")}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Vehicle</span><span className="font-mono font-medium">{vehicleNumber.toUpperCase()}</span></div>
              </div>

              {realPayments ? (
                <>
                  <div className="rounded-xl border-2 border-primary/30 p-4 space-y-2">
                    <p className="font-semibold">Pay securely with Razorpay</p>
                    <p className="text-sm text-muted-foreground">UPI (GPay, PhonePe, Paytm), debit and credit cards, net banking and wallets.</p>
                  </div>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" /> {payments.data?.refundPolicy}
                  </p>
                  <Button className="w-full h-12 font-bold text-base" onClick={payWithRazorpay} disabled={isProcessing}>
                    {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Waiting for payment...</> : <>Pay ₹{total}</>}
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Demo payment: no real money is charged. Online payments start working once Razorpay keys are added on the server.
                  </p>
                  <div>
                    <p className="text-sm font-semibold mb-3">Select payment method</p>
                    <div className="space-y-2">
                      {DEMO_METHODS.map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setSelectedPayment(method.id)}
                          className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                            selectedPayment === method.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                          }`}
                        >
                          <span className="text-xl">{method.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">{method.label}</p>
                            <p className="text-muted-foreground text-xs">{method.desc}</p>
                          </div>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedPayment === method.id ? "border-primary" : "border-border"}`}>
                            {selectedPayment === method.id && <div className="w-2 h-2 bg-primary rounded-full" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                    <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>{payments.data?.refundPolicy ?? "Full refund if you cancel before your parking time starts."}</span>
                  </div>
                  <Button className="w-full h-12 font-bold text-base" onClick={bookWithoutGateway} disabled={isProcessing}>
                    {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing payment...</> : <>Pay ₹{total} (demo)</>}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Step: Success */}
          {step === "success" && result && (
            <div className="p-8 text-center space-y-5">
              <div className="flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mx-auto">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">Booking Confirmed!</h3>
                <p className="text-muted-foreground text-sm">
                  Your spot at {spot.name} has been reserved for {durationHours} hour{durationHours > 1 ? "s" : ""}.
                </p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vehicle</span>
                  <span className="font-mono font-bold">{vehicleNumber.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span className="font-bold text-green-600">
                    ₹{result.amount}{result.free ? " (free reward)" : result.demo ? " (demo)" : ""}
                  </span>
                </div>
                {result.slot && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your slot</span>
                    <span className="font-mono font-bold">{result.slot}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booking ID</span>
                  <span className="font-mono text-primary">#{result.id}</span>
                </div>
              </div>
              {spot.isLargeFacility && <p className="text-sm text-muted-foreground">Open the booking to see the QR code for the entrance.</p>}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={handleClose}>Done</Button>
                <Button className="flex-1" onClick={goToBooking}>{spot.isLargeFacility ? "Show QR Code" : "View Booking"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Wrong timing: tell the driver plainly instead of showing a negative price. */}
      <AlertDialog open={timingAlert !== null} onOpenChange={(next) => !next && setTimingAlert(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive" /> Wrong timing selection
            </AlertDialogTitle>
            <AlertDialogDescription>{timingAlert}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setTimingAlert(null)}>OK, change the time</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
