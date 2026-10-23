/**
 * Driver feature 3: Driver Analytics.
 * Five headline numbers and three charts from the driver's booking history.
 */
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck, Clock, IndianRupee, MapPin, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rupees, useDriverAnalytics, type DriverAnalyticsResponse } from "@/lib/ds-api";
import { BarList, ChartBox, ChartCard, EmptyState, QueryState, SERIES, StatTile, SyntheticNote, axisTick, gridStroke, tooltipCursor, tooltipStyle } from "./ChartKit";

export function DriverAnalytics({ userId }: { userId: number | undefined }) {
  const query = useDriverAnalytics(userId);
  return (
    <QueryState query={query} skeletonHeight={360}>
      {(data) => (data.has_data ? <AnalyticsBody data={data} /> : (
        <EmptyState title="No parking history yet" icon={CalendarCheck}>
          <p>Your insights appear here after your first booking.</p>
          <Link href="/spots"><Button className="mt-4">Find parking</Button></Link>
        </EmptyState>
      ))}
    </QueryState>
  );
}

/** "Evening (16-20)" -> "16:00–20:00" */
function timeRange(period: string | undefined): string | undefined {
  const match = period?.match(/\((\d+)-(\d+)\)/);
  return match ? `${match[1]}:00–${match[2]}:00` : undefined;
}

function AnalyticsBody({ data }: { data: DriverAnalyticsResponse }) {
  const months = data.by_month ?? [];
  const zones = (data.by_zone ?? []).slice(0, 8);
  const fewMonths = months.length < 2;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {data.source === "history" ? (
          <>
            <span>Showing this demo account's linked booking history ({data.first_booking} to {data.last_booking}).</span>
            <SyntheticNote>Synthetic history</SyntheticNote>
          </>
        ) : (
          <span>From your ParkEase bookings ({data.first_booking} to {data.last_booking}).</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatTile label="Total bookings" value={data.total_bookings} icon={CalendarCheck}
          hint={`${data.completed_bookings} completed, ${data.cancelled_bookings} cancelled`} />
        <StatTile label="Avg parking duration" value={`${data.avg_duration_hours?.toFixed(1)} h`} icon={Clock} />
        <StatTile label="Avg spending" value={rupees(data.avg_spending)} icon={IndianRupee}
          hint={`${rupees(data.total_spending)} in total`} />
        <StatTile label="Most used zone" value={data.most_used_zone} icon={MapPin} />
        <StatTile label="Preferred time" value={data.preferred_time?.split(" (")[0]} icon={Sunrise}
          hint={timeRange(data.preferred_time)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Bookings by month" description="How often you park, month by month.">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(v) => [v, "Bookings"]} />
                <Bar isAnimationActive={false} dataKey="bookings" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </ChartCard>

        <ChartCard title="Bookings by parking zone" description="Where you park most.">
          <BarList unit="" rows={zones.map((z) => ({
            label: z.zone, value: z.bookings,
            note: `${Math.round((z.bookings / data.total_bookings) * 100)}%`,
          }))} />
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Average spending per booking" description="Completed and active bookings, by month.">
          {fewMonths ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              A trend needs at least two months of bookings. So far: {rupees(data.avg_spending)} per booking.
            </p>
          ) : (
            <ChartBox height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={months.filter((m) => m.avg_spending !== null)}
                  margin={{ top: 8, right: 12, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [rupees(Number(v)), "Average per booking"]} />
                  <Line isAnimationActive={false} dataKey="avg_spending" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartBox>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
