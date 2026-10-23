import { Link } from "wouter";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRewards } from "@/lib/app-api";

/**
 * Driver rewards: one free booking for every ten paid bookings.
 * Shows the progress as ten steps and any free booking ready to use.
 */
export function RewardsCard({ showFindParking = true }: { showFindParking?: boolean }) {
  const { data, isLoading, isError } = useRewards();

  if (isLoading) return <Skeleton className="h-36 w-full rounded-xl" />;
  if (isError || !data) return null;

  const steps = Array.from({ length: data.bookingsPerReward }, (_, i) => i < data.progress);
  const hasReward = data.available > 0;

  return (
    <Card className={hasReward ? "border-2 border-primary/50 bg-primary/5" : "border"} data-testid="rewards-card">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Gift className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">Parking rewards</h2>
              <p className="text-sm text-muted-foreground">
                Book {data.bookingsPerReward} times and your next booking is free.
              </p>
            </div>
          </div>
          {hasReward ? (
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
                {data.available} free booking{data.available > 1 ? "s" : ""} ready
              </span>
              {showFindParking && (
                <Link href="/spots"><Button size="sm">Use it</Button></Link>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-5">
          <div
            className="flex gap-1.5"
            role="img"
            aria-label={`${data.progress} of ${data.bookingsPerReward} bookings towards the next free booking`}
          >
            {steps.map((done, i) => (
              <div key={i} className={`h-2.5 flex-1 rounded-full ${done ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <p className="mt-2 text-sm">
            <span className="font-semibold">{data.progress} of {data.bookingsPerReward}</span>{" "}
            <span className="text-muted-foreground">
              bookings towards your next free booking. {data.remaining} more to go.
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.qualifyingBookings} paid booking{data.qualifyingBookings === 1 ? "" : "s"} so far · {data.earned} reward
            {data.earned === 1 ? "" : "s"} earned · {data.redeemed} used. Cancelled and free bookings do not count.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
