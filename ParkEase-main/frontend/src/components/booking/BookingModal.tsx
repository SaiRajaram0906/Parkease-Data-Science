import { useState } from "react";
import { useCreateBooking, getListBookingsQueryKey, getGetSpotQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, ShieldCheck, CheckCircle, IndianRupee, Clock, Car, Bike } from "lucide-react";
import { addHours, format, setHours, setMinutes, startOfToday, isAfter, isBefore } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Spot {
  id: number;
  name: string;
  address: string;
  city: string;
  pricePerHour: string;
  pricePerDay: string | null | undefined;

  vehicleType: string;
  availableSlots: number;
}

interface BookingModalProps {
  spot: Spot;
  open: boolean;
  onClose: () => void;
}

type Step = "details" | "payment" | "success";

const PAYMENT_METHODS = [
  { id: "upi", label: "UPI", icon: "🏦", desc: "Pay via UPI ID or QR code" },
  { id: "card", label: "Credit / Debit Card", icon: "💳", desc: "Visa, Mastercard, RuPay" },
  { id: "netbanking", label: "Net Banking", icon: "🏛", desc: "All major banks supported" },
  { id: "wallet", label: "Paytm / PhonePe", icon: "📱", desc: "Mobile wallets" },
];

export default function BookingModal({ spot, open, onClose }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createBooking = useCreateBooking();

  const [step, setStep] = useState<Step>("details");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleType, setVehicleType] = useState(spot.vehicleType === "both" ? "car" : spot.vehicleType);
  
  const [date, setDate] = useState<Date>(startOfToday());
  const [startHour, setStartHour] = useState("10");
  const [endHour, setEndHour] = useState("11");

  const [selectedPayment, setSelectedPayment] = useState("upi");
  const [upiId, setUpiId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [bookingId, setBookingId] = useState<number | null>(null);

  const startTime = setMinutes(setHours(date, parseInt(startHour)), 0);
  const endTime = setMinutes(setHours(date, parseInt(endHour)), 0);
  const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  const total = (parseFloat(spot.pricePerHour) * durationHours).toFixed(2);

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleNumber.trim()) {
      toast({ title: "Vehicle number required", variant: "destructive" });
      return;
    }
    if (durationHours <= 0) {
      toast({ title: "Invalid time range", description: "End time must be after start time", variant: "destructive" });
      return;
    }
    if (isBefore(startTime, new Date())) {
      toast({ title: "Invalid time", description: "Start time cannot be in the past", variant: "destructive" });
      return;
    }
    setStep("payment");
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    await new Promise((r) => setTimeout(r, 2200));

    try {
      const booking = await createBooking.mutateAsync({
        data: {
          spotId: spot.id,
          userId: user?.id ?? 2,
          vehicleNumber: vehicleNumber.trim().toUpperCase(),
          vehicleType,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationHours: durationHours.toString(),
          totalAmount: total,
          notes: `Payment via ${selectedPayment}`,
        },
      });

      setBookingId(booking.id);
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(spot.id) });
      setStep("success");
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || "";
      if (errorMsg.includes("already booked")) {
        toast({ 
          title: "Slot Unavailable", 
          description: "The chosen time slot is already booked. Please select a different time.", 
          variant: "destructive" 
        });
        setStep("details"); // Go back to details to let them change the time
      } else {
        toast({ title: "Booking failed", description: "Could not complete your booking. Please try again.", variant: "destructive" });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setStep("details");
    setVehicleNumber("");
    setStartHour("10");
    setEndHour("11");
    onClose();
  };

  const goToBooking = () => {
    handleClose();
    if (bookingId) setLocation(`/bookings/${bookingId}`);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-[#1a1a2e] px-6 py-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
            <span className="text-[#4ade80] text-xs font-semibold uppercase tracking-wider">Secure Checkout</span>
          </div>
          <DialogTitle className="text-white text-xl font-bold">{spot.name}</DialogTitle>
          <p className="text-white/50 text-sm">{spot.address}, {spot.city}</p>
        </div>

        {/* Step: Details */}
        {step === "details" && (
          <form onSubmit={handleDetailsSubmit} className="p-6 space-y-5">
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
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full h-11 justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                      )}
                    >
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
                      disabled={(date) => isBefore(date, startOfToday())}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">Start Time</Label>
                  <Select value={startHour} onValueChange={setStartHour}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Start" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {format(setHours(new Date(), i), "hh:00 a")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">End Time</Label>
                  <Select value={endHour} onValueChange={setEndHour}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="End" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {format(setHours(new Date(), i), "hh:00 a")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
                      className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        vehicleType === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
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
                placeholder="e.g. MH 01 AB 1234"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                className="mt-1.5 h-11 font-mono tracking-wider uppercase"
                required
              />
            </div>

            <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Start time</span>
                <span className="font-medium">{format(startTime, "hh:mm a, dd MMM")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">End time</span>
                <span className="font-medium">{format(endTime, "hh:mm a, dd MMM")}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2">
                <span className="font-semibold">Total amount</span>
                <span className="font-bold text-primary text-base">₹{total}</span>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-semibold">
              Proceed to Payment
            </Button>
          </form>
        )}

        {/* Step: Payment */}
        {step === "payment" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between text-sm">
              <button onClick={() => setStep("details")} className="text-muted-foreground hover:text-foreground transition-colors">
                Back
              </button>
              <Badge variant="outline" className="text-primary border-primary/30 font-bold">
                ₹{total} due
              </Badge>
            </div>

            <div>
              <p className="text-sm font-semibold mb-3">Select payment method</p>
              <div className="space-y-2">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setSelectedPayment(method.id)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                      selectedPayment === method.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="text-xl">{method.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{method.label}</p>
                      <p className="text-muted-foreground text-xs">{method.desc}</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      selectedPayment === method.id ? "border-primary" : "border-border"
                    }`}>
                      {selectedPayment === method.id && <div className="w-2 h-2 bg-primary rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedPayment === "upi" && (
              <div>
                <Label htmlFor="upi-id" className="text-sm font-medium">UPI ID</Label>
                <Input
                  id="upi-id"
                  placeholder="name@upi or phone@paytm"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="mt-1.5 h-11"
                />
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
              <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>Secured by 256-bit SSL encryption. Your payment info is safe.</span>
            </div>

            <Button className="w-full h-12 font-bold text-base" onClick={handlePayment} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing payment...
                </>
              ) : (
                <>Pay ₹{total}</>
              )}
            </Button>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="p-8 text-center space-y-5">
            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mx-auto">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold mb-1">Booking Confirmed!</h3>
              <p className="text-muted-foreground text-sm">
                Your spot at {spot.name} has been reserved for {durationHours} hour{Number(durationHours) > 1 ? "s" : ""}.
              </p>
            </div>
            <div className="bg-muted/30 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vehicle</span>
                <span className="font-mono font-bold">{vehicleNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount paid</span>
                <span className="font-bold text-green-600">₹{total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Booking ID</span>
                <span className="font-mono text-primary">#{bookingId}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Done</Button>
              <Button className="flex-1" onClick={goToBooking}>View Booking</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
