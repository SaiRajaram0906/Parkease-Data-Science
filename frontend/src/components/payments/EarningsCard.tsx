import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EARNINGS_KEY, savePayoutDetails, useEarnings, usePaymentConfig } from "@/lib/app-api";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Owner earnings: what completed, paid bookings earned, the platform
 * commission, what has been paid out and what is still owed, plus where
 * the owner wants to be paid (UPI ID).
 */
export function EarningsCard() {
  const { data, isLoading, isError } = useEarnings();
  const payments = usePaymentConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [upi, setUpi] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setUpi(data.payoutUpi ?? "");
      setName(data.payoutName ?? "");
    }
  }, [data]);

  if (isLoading) return <Skeleton className="h-56 w-full rounded-xl" />;
  if (isError || !data) return null;

  const save = async () => {
    setSaving(true);
    try {
      await savePayoutDetails({ payoutUpi: upi.trim(), payoutName: name.trim() });
      await queryClient.invalidateQueries({ queryKey: EARNINGS_KEY });
      toast({ title: "Payout details saved", description: upi ? `Earnings will be sent to ${upi.trim()}.` : "Payout details removed." });
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const tiles = [
    { label: "Earned from completed bookings", value: rupees(data.gross), note: `${data.completedPaidBookings} paid booking${data.completedPaidBookings === 1 ? "" : "s"}` },
    { label: `Platform commission (${data.commissionPercent}%)`, value: `− ${rupees(data.commission)}`, note: "kept by ParkEase" },
    { label: "Paid out to you", value: rupees(data.paidOut), note: `${data.payouts.length} payout${data.payouts.length === 1 ? "" : "s"}` },
    { label: "Balance to be paid", value: rupees(data.balance), note: "sent to your UPI ID", strong: true },
  ];

  return (
    <Card className="border shadow-sm" data-testid="earnings-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Wallet className="h-5 w-5 text-primary" /> Earnings and payouts</CardTitle>
        <CardDescription>
          {payments.data?.mode === "razorpay"
            ? "Drivers pay through Razorpay. Your share of every completed booking is paid out to your UPI ID."
            : "Payments are in demo mode, so these figures show how payouts will work; no real money has moved."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-xl p-3 sm:p-4 ${t.strong ? "bg-primary/10" : "bg-muted/40"}`}>
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className={`mt-1 text-lg font-bold sm:text-xl ${t.strong ? "text-primary" : ""}`}>{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.note}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="payout-upi">Your UPI ID for payouts</Label>
            <Input id="payout-upi" className="mt-1.5" placeholder="yourname@okhdfcbank" value={upi} onChange={(e) => setUpi(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="payout-name">Account holder name</Label>
            <Input id="payout-name" className="mt-1.5" placeholder="As shown in your bank" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>

        {data.payouts.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">Payout history</p>
            <div className="divide-y rounded-lg border text-sm">
              {data.payouts.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>{format(new Date(p.createdAt), "dd MMM yyyy")}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>
                  <span className="font-semibold">{rupees(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
