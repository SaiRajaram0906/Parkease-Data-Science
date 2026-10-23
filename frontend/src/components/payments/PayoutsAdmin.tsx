import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { recordPayout, useOwnerBalances, usePaymentConfig } from "@/lib/app-api";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Owner = { ownerId: number; ownerName: string; payoutUpi: string | null; balance: number };

/**
 * Admin: every owner's balance. After sending the money (UPI or bank
 * transfer), the admin records the payout with its transaction reference.
 */
export function PayoutsAdmin() {
  const { data, isLoading } = useOwnerBalances();
  const payments = usePaymentConfig();
  const [owner, setOwner] = useState<Owner | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Payment mode: <strong>{payments.data?.mode === "razorpay" ? "Razorpay (real payments)" : "demo (no real money)"}</strong>.
        Platform commission {payments.data?.commissionPercent ?? 10}%. Send each owner their balance by UPI or bank transfer, then record it here.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">UPI ID</th>
              <th className="px-4 py-3 text-right">Completed paid</th>
              <th className="px-4 py-3 text-right">Owner share</th>
              <th className="px-4 py-3 text-right">Paid out</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ownerId} className="border-t">
                <td className="px-4 py-3 font-medium">{r.ownerName}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.payoutUpi ?? <span className="text-muted-foreground">not set</span>}</td>
                <td className="px-4 py-3 text-right">{r.completedPaidBookings}</td>
                <td className="px-4 py-3 text-right">{rupees(r.net)}</td>
                <td className="px-4 py-3 text-right">{rupees(r.paidOut)}</td>
                <td className="px-4 py-3 text-right font-semibold">{rupees(r.balance)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" disabled={r.balance <= 0} onClick={() => setOwner(r)} aria-label={`Record payout for ${r.ownerName}`}>
                    Record payout
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner && <RecordPayoutDialog owner={owner} onClose={() => setOwner(null)} />}
    </div>
  );
}

function RecordPayoutDialog({ owner, onClose }: { owner: Owner; onClose: () => void }) {
  const [amount, setAmount] = useState(owner.balance.toFixed(2));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const save = async () => {
    setSaving(true);
    try {
      await recordPayout({ ownerId: owner.ownerId, amount: Number(amount), reference: reference.trim() });
      await queryClient.invalidateQueries({ queryKey: ["payouts"] });
      toast({ title: "Payout recorded", description: `${rupees(Number(amount))} to ${owner.ownerName}.` });
      onClose();
    } catch (err) {
      toast({ title: "Not recorded", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Record payout to {owner.ownerName}</DialogTitle>
          <DialogDescription>
            Send the money first{owner.payoutUpi ? ` to ${owner.payoutUpi}` : ""}, then enter the UPI or bank transaction reference.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="payout-amount">Amount (₹), balance {rupees(owner.balance)}</Label>
            <Input id="payout-amount" className="mt-1.5" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="payout-ref">Transaction reference</Label>
            <Input id="payout-ref" className="mt-1.5" placeholder="UPI reference number" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !reference.trim() || !(Number(amount) > 0)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Record payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
