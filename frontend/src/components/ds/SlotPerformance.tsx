/**
 * Owner feature 2: Slot Performance Analytics.
 * Six headline numbers and four charts. Revenue counts completed bookings only.
 */
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Ban, CalendarCheck, Clock, Gauge, IndianRupee, ParkingSquare, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hourLabel, rupees, type OwnerAnalyticsResponse } from "@/lib/ds-api";
import { BarList, ChartBox, ChartCard, EmptyState, SERIES, StatTile, SyntheticNote, axisTick, gridStroke, tooltipCursor, tooltipStyle } from "./ChartKit";

export function SlotPerformance({ data }: { data: OwnerAnalyticsResponse }) {
  if (!data.has_data) {
    return (
      <EmptyState title={data.listings ? "No bookings on your listings yet" : "You have not listed a parking spot yet"} icon={ParkingSquare}>
        <p>
          {data.listings
            ? "Performance analytics appear here once drivers start booking your spots."
            : "List a spot to start earning and to see performance analytics here."}
        </p>
        {!data.listings && <Link href="/list-spot"><Button className="mt-4">List your spot</Button></Link>}
      </EmptyState>
    );
  }
  const months = data.revenue_by_month ?? [];
  const hasOccupancy = data.occupancy_rate !== null && data.occupancy_rate !== undefined;
  const occupancyMonths = months.filter((m) => m.occupancy !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {data.source === "history" ? (
          <>
            <span>Showing the linked booking history of this demo owner's {data.listings} listings.</span>
            <SyntheticNote>Synthetic history</SyntheticNote>
          </>
        ) : (
          <span>From live ParkEase bookings on your {data.listings} listing{data.listings === 1 ? "" : "s"}.</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total bookings" value={data.total_bookings.toLocaleString("en-IN")} icon={CalendarCheck} />
        <StatTile label="Occupancy rate" value={hasOccupancy ? `${data.occupancy_rate}%` : "–"} icon={Gauge}
          hint={hasOccupancy ? "when booked, multi-space listings" : "not recorded for live bookings"} />
        <StatTile label="Completed revenue" value={rupees(data.completed_revenue)} icon={IndianRupee} hint="completed bookings only" />
        <StatTile label="Avg parking duration" value={`${data.avg_duration_hours?.toFixed(1)} h`} icon={Clock} />
        <StatTile label="Peak demand time" value={data.peak_hour !== undefined ? hourLabel(data.peak_hour) : "–"} icon={Zap} />
        <StatTile label="Cancellation rate" value={data.cancellation_rate !== null && data.cancellation_rate !== undefined ? `${data.cancellation_rate}%` : "–"} icon={Ban} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Revenue over time" description="Completed bookings, by month.">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tick={axisTick} width={48}
                  tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [rupees(Number(v)), "Completed revenue"]} />
                <Line isAnimationActive={false} dataKey="revenue" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </ChartCard>

        <ChartCard title="Occupancy trend" description="Average share of spaces taken when a booking was made.">
          {occupancyMonths.length ? (
            <ChartBox>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={occupancyMonths} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, "Occupancy"]} />
                  <Line isAnimationActive={false} dataKey="occupancy" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartBox>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Live bookings do not record how full a listing was, so there is no occupancy trend to show yet.
            </p>
          )}
        </ChartCard>

        <ChartCard title="Bookings by hour" description="When drivers start parking at your listings.">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(data.bookings_by_hour ?? []).map((h) => ({ ...h, short: h.label.slice(0, 2) }))} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(l) => `${l}:00`} formatter={(v) => [v, "Bookings"]} />
                <Bar isAnimationActive={false} dataKey="bookings" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </ChartCard>

        <ChartCard title="Booking status" description="How bookings on your listings ended.">
          <BarList rows={(data.status_distribution ?? []).map((s) => ({
            label: s.status, value: s.share, note: `${s.bookings.toLocaleString("en-IN")} bookings`,
          }))} max={100} />
          <p className="mt-4 text-xs text-muted-foreground">
            "Active" bookings have not finished yet and are not counted as revenue.
          </p>
        </ChartCard>
      </div>

      {data.by_slot.length > 0 && (
        <ChartCard title="Performance by listing">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="rounded-tl-lg px-4 py-2.5">Listing</th>
                  <th className="px-4 py-2.5 text-right">Bookings</th>
                  <th className="px-4 py-2.5 text-right">Completed revenue</th>
                  <th className="px-4 py-2.5 text-right">Occupancy</th>
                  <th className="rounded-tr-lg px-4 py-2.5 text-right">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {data.by_slot.map((slot) => (
                  <tr key={slot.slot_id} className="border-b border-border/50">
                    <td className="px-4 py-2.5 font-medium">
                      {slot.spot_id ? <Link href={`/spots/${slot.spot_id}`} className="hover:underline">{slot.name}</Link> : slot.name}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{slot.bookings}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rupees(slot.completed_revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" title={slot.occupancy === null ? "Not measurable for a single-space listing" : undefined}>{slot.occupancy === null ? "n/a" : `${slot.occupancy}%`}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{slot.cancellation_rate === null ? "–" : `${slot.cancellation_rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}
    </div>
  );
}
