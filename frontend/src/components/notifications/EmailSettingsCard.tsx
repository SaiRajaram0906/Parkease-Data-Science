import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { emailStatusText, sendTestEmail, useEmailStatus, type AppNotification } from "@/lib/app-api";

/**
 * Shows whether this server can send email, and sends a test message to the
 * signed-in user's own address, so the start/end messages can be checked
 * without waiting for a booking.
 */
export function EmailSettingsCard({ email }: { email: string }) {
  const { data: status } = useEmailStatus();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AppNotification | null>(null);
  const [error, setError] = useState("");

  const send = async () => {
    setSending(true);
    setError("");
    setResult(null);
    try {
      setResult(await sendTestEmail());
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the test email.");
    } finally {
      setSending(false);
    }
  };

  const ok = result?.emailStatus === "sent";

  return (
    <Card className="border-none shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Booking emails</CardTitle>
        <CardDescription>
          When your parking time starts and when it ends, a message is sent to <strong>{email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <p className="flex items-start gap-2 text-sm">
            {status.configured ? (
              <><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> Email sending is set up on this server ({status.from}).</>
            ) : (
              <><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> Email sending is not set up on this server yet. Messages still appear in the app. To send real emails, add SMTP_USER and SMTP_PASS to backend/.env and restart the server.</>
            )}
          </p>
        )}
        <Button variant="outline" onClick={send} disabled={sending}>
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
          Send a test email
        </Button>
        {result && (
          <p className={`text-sm ${ok ? "text-green-600" : "text-amber-700 dark:text-amber-400"}`} role="status">
            {emailStatusText(result)}
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
