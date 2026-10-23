import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { CircleCheck, CircleX, Clock, Loader2, QrCode, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { checkPass, confirmEntry, type PassCheck } from "@/lib/app-api";

const TONE: Record<PassCheck["state"], { box: string; text: string; title: string }> = {
  valid: { box: "border-green-600 bg-green-600/10", text: "text-green-700 dark:text-green-400", title: "Valid pass" },
  checked_in: { box: "border-blue-600 bg-blue-600/10", text: "text-blue-700 dark:text-blue-400", title: "Already entered" },
  early: { box: "border-amber-500 bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", title: "Too early" },
  expired: { box: "border-red-600 bg-red-600/10", text: "text-red-700 dark:text-red-400", title: "Expired" },
  cancelled: { box: "border-red-600 bg-red-600/10", text: "text-red-700 dark:text-red-400", title: "Cancelled" },
};

/**
 * Verify Entry (owners and admins).
 *
 * A driver's QR code opens this page with the pass code in the address, so
 * scanning it with a phone camera is enough. The code can also be typed in.
 * The server only answers for bookings at the signed-in owner's own places.
 */
export default function VerifyEntry() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const scanned = params.code ? decodeURIComponent(params.code) : "";

  const [code, setCode] = useState(scanned);
  const [result, setResult] = useState<PassCheck | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"check" | "enter" | null>(null);

  const check = async (value: string) => {
    const cleaned = value.trim().toUpperCase();
    if (!cleaned) return;
    setBusy("check");
    setError("");
    setResult(null);
    try {
      setResult(await checkPass(cleaned));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this code.");
    } finally {
      setBusy(null);
    }
  };

  // A scanned QR code is checked straight away.
  useEffect(() => {
    if (scanned) {
      setCode(scanned);
      void check(scanned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const allowEntry = async () => {
    if (!result) return;
    setBusy("enter");
    try {
      setResult(await confirmEntry(code));
      toast({ title: "Entry recorded", description: `${result.booking.vehicleNumber} may enter.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not record the entry.";
      toast({ title: "Entry not recorded", description: message, variant: "destructive" });
      void check(code);
    } finally {
      setBusy(null);
    }
  };

  const tone = result ? TONE[result.state] : null;
  const StateIcon = result?.state === "valid" || result?.state === "checked_in" ? CircleCheck : result?.state === "early" ? Clock : CircleX;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ScanLine className="h-7 w-7 text-primary" /> Verify Entry
        </h1>
        <p className="text-muted-foreground">Check a driver's entry pass before letting the vehicle in.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><QrCode className="h-5 w-5 text-primary" /> Entry pass</CardTitle>
          <CardDescription>
            Scan the driver's QR code with your phone camera (it opens this page), or type the pass code shown under it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (scanned && scanned !== code.trim().toUpperCase()) setLocation("/verify");
              void check(code);
            }}
          >
            <div className="flex-1">
              <Label htmlFor="pass-code">Pass code</Label>
              <Input
                id="pass-code"
                placeholder="PE-XXXXXXXX"
                className="mt-1.5 h-12 font-mono text-lg uppercase tracking-wider"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoComplete="off"
              />
            </div>
            <Button type="submit" className="h-12 px-6" disabled={busy !== null || !code.trim()}>
              {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Check pass
            </Button>
          </form>

          {error && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border-2 border-red-600 bg-red-600/10 p-4" role="alert">
              <CircleX className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
              <div>
                <p className="font-bold text-red-700 dark:text-red-400">Not valid</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {result && tone && (
            <div className={`mt-6 rounded-xl border-2 p-5 ${tone.box}`} role="status" data-testid="pass-result">
              <div className="flex items-start gap-3">
                <StateIcon className={`mt-0.5 h-7 w-7 shrink-0 ${tone.text}`} />
                <div>
                  <p className={`text-xl font-bold ${tone.text}`}>{tone.title}</p>
                  <p className="text-sm">{result.message}</p>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Vehicle</dt>
                  <dd className="font-mono text-lg font-bold">{result.booking.vehicleNumber}</dd>
                  <dd className="capitalize text-muted-foreground">{result.booking.vehicleType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Slot</dt>
                  <dd className="font-mono text-lg font-bold">{result.booking.slotLabel ?? "Any free slot"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Driver</dt>
                  <dd className="font-medium">{result.booking.driverName ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Booking</dt>
                  <dd className="font-medium">#{result.booking.id}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Parking place</dt>
                  <dd className="font-medium">{result.booking.spotName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">From</dt>
                  <dd className="font-medium">{format(new Date(result.booking.startTime), "MMM d, h:mm a")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Until</dt>
                  <dd className="font-medium">{format(new Date(result.booking.endTime), "MMM d, h:mm a")}</dd>
                </div>
                {result.booking.checkedInAt && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Entered at</dt>
                    <dd className="font-medium">{format(new Date(result.booking.checkedInAt), "MMM d, h:mm a")}</dd>
                  </div>
                )}
              </dl>

              {result.state === "valid" && (
                <Button className="mt-6 h-12 w-full text-base font-bold" onClick={allowEntry} disabled={busy !== null}>
                  {busy === "enter" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleCheck className="mr-2 h-5 w-5" />}
                  Allow entry
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
