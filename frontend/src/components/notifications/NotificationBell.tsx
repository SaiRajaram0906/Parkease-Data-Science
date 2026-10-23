import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Bell, CircleCheck, Flag, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { emailStatusText, useNotifications, type AppNotification } from "@/lib/app-api";

const SEEN_KEY = "parkease_notifications_seen";

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function NotificationIcon({ kind }: { kind: string }) {
  if (kind === "booking_started") return <CircleCheck className="h-4 w-4 text-green-600" aria-hidden />;
  if (kind === "booking_ended") return <Flag className="h-4 w-4 text-blue-600" aria-hidden />;
  return <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

/** One message: what it says, when, and whether the email went out. */
export function NotificationItem({ item, onNavigate }: { item: AppNotification; onNavigate?: () => void }) {
  const content = (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0"><NotificationIcon kind={item.kind} /></div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{item.subject}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })} · {emailStatusText(item)}
        </p>
      </div>
    </div>
  );
  return item.bookingId ? (
    <Link href={`/bookings/${item.bookingId}`} onClick={onNavigate} className="block rounded-md p-2 hover:bg-muted">
      {content}
    </Link>
  ) : (
    <div className="p-2">{content}</div>
  );
}

/** Bell in the top bar with the driver's booking messages. */
export function NotificationBell() {
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const items = data ?? [];
  const newest = items[0]?.id ?? 0;
  const unread = items.filter((n) => n.id > seen).length;

  // Opening the list marks everything in it as read.
  useEffect(() => {
    if (open && newest > seen) {
      setSeen(newest);
      try {
        localStorage.setItem(SEEN_KEY, String(newest));
      } catch {
        // private browsing: the badge simply reappears next time
      }
    }
  }, [open, newest, seen]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={unread ? `Messages, ${unread} new` : "Messages"}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-2">
        <p className="px-2 pb-2 pt-1 text-sm font-bold">Messages</p>
        {items.length === 0 ? (
          <p className="px-2 pb-3 text-sm text-muted-foreground">
            Nothing yet. You get a message here, and by email, when your parking time starts and when it ends.
          </p>
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto">
            {items.slice(0, 10).map((item) => (
              <NotificationItem key={item.id} item={item} onNavigate={() => setOpen(false)} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
