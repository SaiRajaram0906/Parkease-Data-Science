/**
 * ParkEase Analytics: the Data Science dashboard.
 * EDA of the historical dataset, live predictions, and model evaluation.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListSpots } from "@workspace/api-client-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis, ReferenceLine,
} from "recharts";
import { BarChart3, CalendarCheck, CheckCircle2, Database, Gauge, IndianRupee, Loader2, ParkingSquare, Users, XCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  rupees, seedDemoData, useDataQuality, useModelPerformance, useOwnerAnalytics, useParkingOverview,
  type DemandLevel, type ModelPerformanceResponse, type ModelReport, type OverviewResponse,
} from "@/lib/ds-api";
import {
  BarList, ChartBox, ChartCard, DEMAND_COLOR, Legend, QueryState, SERIES, StatTile, SyntheticNote,
  axisTick, gridStroke, tooltipCursor, tooltipStyle,
} from "@/components/ds/ChartKit";
import { AvailabilityForecast } from "@/components/ds/AvailabilityForecast";
import { DemandForecast } from "@/components/ds/DemandForecast";
import { PriceRecommendation } from "@/components/ds/PriceRecommendation";

const TABS = [
  ["overview", "Overview"],
  ["demand", "Parking demand"],
  ["occupancy", "Occupancy"],
  ["revenue", "Revenue"],
  ["behaviour", "User behaviour"],
  ["predictions", "Predictions"],
  ["models", "Model performance"],
] as const;

const DEMAND_LEVELS: DemandLevel[] = ["Low", "Medium", "High"];
const lakh = (value: number) => `₹${(value / 100000).toFixed(1)}L`;

export default function Analytics() {
  const overview = useParkingOverview();
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <BarChart3 className="h-7 w-7 text-primary" />
            ParkEase Analytics
          </h1>
          <p className="mt-1 text-muted-foreground">
            What a year of parking history says about demand, occupancy and revenue, and how well the models predict them.
          </p>
        </div>
        <SeedDemoButton />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-semibold">Synthetic dataset.</span> Every chart on this page describes a generated
          historical dataset used to build and test the Data Science pipeline. The findings are not real-world parking statistics.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <div className="-mx-4 mb-6 overflow-x-auto px-4">
          <TabsList className="h-auto w-max">
            {TABS.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
          </TabsList>
        </div>

        <TabsContent value="overview"><QueryState query={overview} skeletonHeight={500}>{(d) => <OverviewTab data={d} />}</QueryState></TabsContent>
        <TabsContent value="demand"><QueryState query={overview} skeletonHeight={500}>{(d) => <DemandTab data={d} />}</QueryState></TabsContent>
        <TabsContent value="occupancy"><QueryState query={overview} skeletonHeight={500}>{(d) => <OccupancyTab data={d} />}</QueryState></TabsContent>
        <TabsContent value="revenue"><QueryState query={overview} skeletonHeight={500}>{(d) => <RevenueTab data={d} />}</QueryState></TabsContent>
        <TabsContent value="behaviour"><QueryState query={overview} skeletonHeight={500}>{(d) => <BehaviourTab data={d} />}</QueryState></TabsContent>
        <TabsContent value="predictions"><PredictionsTab /></TabsContent>
        <TabsContent value="models"><ModelsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo data loader (owners and admins)
// ---------------------------------------------------------------------------
function SeedDemoButton() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (user?.role !== "admin" && user?.role !== "owner") return null;

  const run = async () => {
    setBusy(true);
    try {
      const result = await seedDemoData();
      toast({
        title: result.spotsCreated ? "Demo data loaded" : "Demo data is already loaded",
        description: `${result.spotsCreated} spots and ${result.usersCreated} accounts added. Existing data was not changed.`,
      });
      queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: "Could not load demo data", description: (error as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy} className="shrink-0">
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
      Load demo data
    </Button>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">{children}</div>;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewTab({ data }: { data: OverviewResponse }) {
  const quality = useDataQuality();
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Bookings" value={t.bookings.toLocaleString("en-IN")} icon={CalendarCheck} hint={`${t.date_from} to ${t.date_to}`} />
        <StatTile label="Parking listings" value={t.listings} icon={ParkingSquare} hint={`${t.active_listings} active`} />
        <StatTile label="Users" value={t.users.toLocaleString("en-IN")} icon={Users} hint={`${t.drivers} drivers, ${t.owners} owners`} />
        <StatTile label="Completed revenue" value={lakh(t.completed_revenue)} icon={IndianRupee} hint="completed bookings only" />
        <StatTile label="Average occupancy" value={`${t.avg_occupancy}%`} icon={Gauge} hint="when a booking was made" />
        <StatTile label="Cancellation rate" value={`${t.cancellation_rate}%`} icon={Ban} hint="of finished bookings" />
      </div>

      <Grid>
        <ChartCard title="Key findings" description="Each statement is computed from the dataset.">
          <ul className="space-y-2.5 text-sm">
            {data.insights.map((insight) => (
              <li key={insight} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4"><SyntheticNote>Synthetic-data findings</SyntheticNote></div>
        </ChartCard>

        <ChartCard title="Data quality" description="Validation and missing-value handling before any analysis.">
          <QueryState query={quality} skeletonHeight={220} compact>
            {(q) => (
              <div className="space-y-4 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  {q.validation.all_passed
                    ? <CheckCircle2 className="h-5 w-5 text-primary" />
                    : <XCircle className="h-5 w-5 text-destructive" />}
                  {q.validation.checks_passed} of {q.validation.checks_total} validation checks passed
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-xs sm:text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="rounded-tl-lg px-3 py-2">Column</th>
                        <th className="px-3 py-2 text-right">Missing</th>
                        <th className="rounded-tr-lg px-3 py-2">How it was handled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.validation.missing_values.map((m) => (
                        <tr key={`${m.table}.${m.column}`} className="border-b border-border/50">
                          <td className="px-3 py-2 font-mono text-xs">{m.column}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.missing} ({m.percent}%)</td>
                          <td className="px-3 py-2 text-muted-foreground">{HANDLING[m.column] ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {q.cleaning && (
                  <p className="text-xs text-muted-foreground">
                    {q.cleaning.bookings.demand_level.left_missing} demand labels stay missing on purpose: demand is a
                    prediction target, so those rows are left out of that model instead of being guessed.
                  </p>
                )}
              </div>
            )}
          </QueryState>
        </ChartCard>
      </Grid>

      <ChartCard title="Summary statistics" description="Centre, spread and shape of the main numeric columns.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="rounded-tl-lg px-3 py-2">Variable</th>
                {["Mean", "Median", "Std dev", "Min", "Q1", "Q3", "Max", "Skew"].map((h, i, all) => (
                  <th key={h} className={`px-3 py-2 text-right ${i === all.length - 1 ? "rounded-tr-lg" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.summary_statistics.map((row) => (
                <tr key={row.column} className="border-b border-border/50">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  {[row.mean, row.median, row.std, row.min, row.q1, row.q3, row.max, row.skew].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

const HANDLING: Record<string, string> = {
  occupancy_rate: "Recomputed from occupied slots / capacity",
  booking_duration_hours: "Recomputed from amount / price",
  price_per_hour: "Recomputed from amount / duration",
  distance_km: "Zone median, learned from the training months only",
  demand_level: "Copied from the same slot and hour, otherwise left missing",
  preferred_vehicle_type: "Inferred from the listings booked or owned",
  vehicle_type_supported: "Inferred from the vehicles that booked it",
};

// ---------------------------------------------------------------------------
// Parking demand
// ---------------------------------------------------------------------------
function DemandTab({ data }: { data: OverviewResponse }) {
  const levels = data.demand_distribution.filter((d) => DEMAND_LEVELS.includes(d.level as DemandLevel));
  const unknown = data.demand_distribution.find((d) => d.level === "Unknown");
  const priceLimit = Math.ceil(Math.max(...data.price_vs_demand.points.map((p) => p.price)) / 20) * 20;
  return (
    <Grid>
      <ChartCard title="When is parking demand highest?" description="Average bookings per day in each hour."
        footer={data.insights[0]}>
        <Legend items={[{ label: "Working days", color: SERIES[0] }, { label: "Weekends and holidays", color: SERIES[1] }]} />
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.bookings_by_hour.map((h) => ({ ...h, short: h.label.slice(0, 2) }))} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `${l}:00`}
                formatter={(v, name) => [Number(v).toFixed(1), name === "weekday" ? "Working days" : "Weekends and holidays"]} />
              <Line isAnimationActive={false} dataKey="weekday" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              <Line isAnimationActive={false} dataKey="weekend" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard title="Which days are busiest?" description="Average bookings per day of the week.">
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.bookings_by_day_of_week} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(v) => [Number(v).toFixed(1), "Bookings per day"]} />
              <Bar isAnimationActive={false} dataKey="per_day" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard title="How balanced are the demand classes?" description="Share of bookings at each demand level."
        footer={unknown ? `${unknown.bookings} bookings (${unknown.share}%) have no demand label and are excluded from the demand model.` : undefined}>
        <ChartBox height={200}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={levels} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="level" tickLine={false} axisLine={false} tick={axisTick} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor}
                formatter={(v, _n, item) => [`${v}% (${item.payload.bookings.toLocaleString("en-IN")} bookings)`, "Share"]} />
              <Bar isAnimationActive={false} dataKey="share" radius={[4, 4, 0, 0]} maxBarSize={72}>
                {levels.map((l) => <Cell key={l.level} fill={DEMAND_COLOR[l.level as DemandLevel]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[380px] text-left text-xs sm:text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr><th className="py-1.5">Level</th><th className="py-1.5 text-right">Occupancy</th><th className="py-1.5 text-right">Price vs base</th><th className="py-1.5 text-right">Cancelled</th></tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.level} className="border-t border-border/50">
                  <td className="py-1.5 font-medium">{l.level}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.occupancy}%</td>
                  <td className="py-1.5 text-right tabular-nums">{l.price_vs_base?.toFixed(2)}x</td>
                  <td className="py-1.5 text-right tabular-nums">{l.cancellation_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard title="Do owners charge more when demand is high?"
        description={`Listed base price against price charged, for a sample of ${data.price_vs_demand.points.length} bookings.`}
        footer={`Points above the dashed line were charged more than the base price. Spearman correlation between demand and price / base: ${data.price_vs_demand.spearman_demand_price_ratio}.`}>
        <Legend items={[
          ...DEMAND_LEVELS.map((level) => ({ label: `${level} demand`, color: DEMAND_COLOR[level] })),
          { label: "Price = base price", color: "hsl(var(--muted-foreground))", dashed: true },
        ]} />
        <ChartBox height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, left: -10, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" dataKey="base_price" domain={[0, 100]} tickLine={false} axisLine={false} tick={axisTick}
                label={{ value: "Base price (₹/h)", position: "insideBottom", offset: -8, fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis type="number" dataKey="price" domain={[0, priceLimit]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `₹${v}`} />
              <ZAxis range={[22, 22]} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }}
                formatter={(v, name) => [`₹${v}`, name === "base_price" ? "Base price" : "Price charged"]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" ifOverflow="hidden" />
              {DEMAND_LEVELS.map((level) => (
                <Scatter key={level} name={level} data={data.price_vs_demand.points.filter((p) => p.level === level)}
                  fill={DEMAND_COLOR[level]} fillOpacity={0.75} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------
function OccupancyTab({ data }: { data: OverviewResponse }) {
  const zones = [...data.zones].sort((a, b) => b.occupancy - a.occupancy);
  return (
    <div className="space-y-6">
      <Grid>
        <ChartCard title="Which zones are used most fully?" description="Average occupancy when a booking was made, by zone."
          footer="Occupancy is only observed at moments when someone booked, and a full listing cannot be booked, so it tops out at 90%.">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zones.map((z) => ({ ...z, short: z.zone.replace("Zone ", "") }))} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(l) => `Zone ${l}`}
                  formatter={(v) => [`${v}%`, "Average occupancy"]} />
                <Bar isAnimationActive={false} dataKey="occupancy" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </ChartCard>

        <ChartCard title="How does occupancy change through the day?" description="Average occupancy by hour.">
          <Legend items={[{ label: "Working days", color: SERIES[0] }, { label: "Weekends and holidays", color: SERIES[1] }]} />
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.bookings_by_hour.map((h) => ({ ...h, short: h.label.slice(0, 2) }))} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `${l}:00`}
                  formatter={(v, name) => [`${Number(v).toFixed(0)}%`, name === "weekday_occupancy" ? "Working days" : "Weekends and holidays"]} />
                <Line isAnimationActive={false} dataKey="weekday_occupancy" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                <Line isAnimationActive={false} dataKey="weekend_occupancy" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </ChartCard>
      </Grid>

      <ChartCard title="How are the main variables related?" description="Spearman rank correlation between pairs of variables.">
        <CorrelationHeatmap correlation={data.correlation} />
      </ChartCard>

      <ChartCard title="Zone comparison">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="rounded-tl-lg px-3 py-2">Zone</th>
                {["Listings", "Bookings", "Occupancy", "Avg price", "High demand", "Cancelled"].map((h, i, all) => (
                  <th key={h} className={`px-3 py-2 text-right ${i === all.length - 1 ? "rounded-tr-lg" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.zones.map((z) => (
                <tr key={z.zone} className="border-b border-border/50">
                  <td className="px-3 py-2 font-medium">{z.zone}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.listings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.bookings.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.occupancy}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{z.avg_price}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.high_demand_share}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.cancellation_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

function CorrelationHeatmap({ correlation }: { correlation: OverviewResponse["correlation"] }) {
  const { labels, cells } = correlation;
  const value = (x: string, y: string) => cells.find((c) => c.x === x && c.y === y)?.value ?? 0;
  const colour = (v: number) =>
    `color-mix(in oklab, ${v >= 0 ? "var(--ds-pos)" : "var(--ds-neg)"} ${Math.round(Math.abs(v) * 100)}%, var(--ds-zero))`;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="mx-auto border-separate border-spacing-0.5 text-[11px]">
          <tbody>
            {labels.map((row) => (
              <tr key={row}>
                <th scope="row" className="whitespace-nowrap pr-2 text-right font-medium text-muted-foreground">{row}</th>
                {labels.map((column) => {
                  const v = value(column, row);
                  return (
                    <td key={column} title={`${row} vs ${column}: ${v.toFixed(2)}`}
                      className="h-9 w-11 min-w-[2.75rem] rounded text-center tabular-nums"
                      style={{ backgroundColor: colour(v), color: Math.abs(v) > 0.6 ? "#fff" : "hsl(var(--foreground))" }}>
                      {v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {labels.map((column) => (
                <th key={column} scope="col" className="h-20 align-top font-medium text-muted-foreground">
                  <span className="inline-block origin-top-left translate-x-5 rotate-45 whitespace-nowrap">{column}</span>
                </th>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>−1</span>
        <span className="h-2.5 w-40 rounded-full" style={{ background: "linear-gradient(to right, var(--ds-neg), var(--ds-zero), var(--ds-pos))" }} />
        <span>+1</span>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Blue: one goes up as the other goes down. Red: they rise together. Grey: no relationship.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------
function RevenueTab({ data }: { data: OverviewResponse }) {
  const zones = [...data.zones].sort((a, b) => b.completed_revenue - a.completed_revenue);
  return (
    <Grid>
      <ChartCard title="Is the platform growing?" description="Bookings per month.">
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthly_trend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
              <YAxis domain={[0, "auto"]} tickLine={false} axisLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v).toLocaleString("en-IN"), "Bookings"]} />
              <Line isAnimationActive={false} dataKey="bookings" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard title="How much revenue is realised each month?" description="Completed bookings only; cancelled bookings earn nothing.">
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly_trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} width={50} tickFormatter={(v) => lakh(Number(v))} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(v) => [rupees(Number(v)), "Completed revenue"]} />
              <Bar isAnimationActive={false} dataKey="completed_revenue" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard className="lg:col-span-2" title="Which zones earn the most?" description="Completed revenue by zone over the year."
        footer={revenueNote(zones)}>
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={zones.map((z) => ({ ...z, short: z.zone.replace("Zone ", "") }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} width={50} tickFormatter={(v) => lakh(Number(v))} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(l) => `Zone ${l}`}
                formatter={(v, _n, item) => [`${rupees(Number(v))} from ${item.payload.bookings.toLocaleString("en-IN")} bookings`, "Completed revenue"]} />
              <Bar isAnimationActive={false} dataKey="completed_revenue" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>
    </Grid>
  );
}

/** Explains the top-revenue zone from the figures, when it is not also the busiest. */
function revenueNote(zones: OverviewResponse["zones"]): string {
  const top = zones[0];
  const busiest = [...zones].sort((a, b) => b.bookings - a.bookings)[0];
  if (top.zone === busiest.zone) {
    return `${top.zone} has both the most bookings and the most completed revenue.`;
  }
  return `${top.zone} earns the most (average ₹${top.avg_price}/h) although ${busiest.zone} has more bookings (average ₹${busiest.avg_price}/h).`;
}

// ---------------------------------------------------------------------------
// User behaviour
// ---------------------------------------------------------------------------
function BehaviourTab({ data }: { data: OverviewResponse }) {
  const b = data.user_behaviour;
  return (
    <Grid>
      <ChartCard title="Do far-away bookings get cancelled more?" description="Cancellation rate by distance between driver and listing."
        footer="Finished bookings only. This is why distance carries the second-largest weight in the recommendation score.">
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.distance_vs_cancellation.map((d) => ({ ...d, short: d.band.replace(" km", "") }))} margin={{ top: 8, right: 8, left: -14, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="short" tickLine={false} axisLine={false} tick={axisTick}
                label={{ value: "Distance (km)", position: "insideBottom", offset: -8, fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(l) => `${l} km`}
                formatter={(v, _n, item) => [`${v}% of ${item.payload.bookings.toLocaleString("en-IN")} bookings`, "Cancelled"]} />
              <Bar isAnimationActive={false} dataKey="cancellation_rate" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard title="How often do drivers book?" description="Number of drivers by bookings made in the year."
        footer={`${b.drivers_with_bookings} of ${b.drivers_total} drivers booked at least once. Median ${b.median_bookings_per_driver} bookings, mean ${b.mean_bookings_per_driver}: a few frequent users pull the mean up.`}>
        <ChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={b.bookings_per_driver} margin={{ top: 8, right: 8, left: -18, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="band" tickLine={false} axisLine={false} tick={axisTick}
                label={{ value: "Bookings per driver", position: "insideBottom", offset: -8, fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(v) => [v, "Drivers"]} />
              <Bar isAnimationActive={false} dataKey="drivers" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>

      <ChartCard title="How do bookings end?" description="Final status of every booking.">
        <BarList max={100} rows={data.status_distribution.map((s) => ({
          label: s.status, value: s.share, note: `${s.bookings.toLocaleString("en-IN")} bookings`,
        }))} />
        <p className="mt-4 text-xs text-muted-foreground">
          "Active" appears only in the last three days of the data: those bookings had not finished when the snapshot was taken.
        </p>
      </ChartCard>

      <ChartCard title="Does a higher price cost bookings?"
        description="Bookings of a listing relative to its zone's typical listing, by how its price compares with similar listings."
        footer={`Spearman correlation between relative price and bookings: ${data.price_elasticity.spearman}. This is the basis of the price ceiling in the price recommendation.`}>
        <ChartBox height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.price_elasticity.bands} margin={{ top: 8, right: 8, left: -14, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis dataKey="band" tickLine={false} axisLine={false} tick={axisTick}
                label={{ value: "Price vs similar listings", position: "insideBottom", offset: -8, fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}x`} />
              <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor}
                formatter={(v, _n, item) => [`${v}x the zone's typical bookings (${item.payload.listings} listings)`, "Bookings"]} />
              <ReferenceLine y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <Bar isAnimationActive={false} dataKey="relative_bookings" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </ChartCard>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Predictions: try the models on a live ParkEase spot
// ---------------------------------------------------------------------------
function PredictionsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // An admin can forecast any spot; an owner only their own listings.
  const allSpots = useListSpots(undefined, { query: { enabled: isAdmin, queryKey: ["spots", "all-for-predictions"] } as any });
  const mine = useOwnerAnalytics(isAdmin ? undefined : user?.id);
  const isLoading = isAdmin ? allSpots.isLoading : mine.isLoading;
  const spots = isAdmin
    ? allSpots.data?.map((s) => ({ id: s.id, name: s.name, pricePerHour: Number(s.pricePerHour), totalSlots: s.totalSlots }))
    : mine.data?.spots.map((s) => ({ id: s.id, name: s.name, pricePerHour: s.pricePerHour, totalSlots: s.totalSlots }));
  const [choice, setChoice] = useState<string>("");
  const spotId = choice ? Number(choice) : spots?.[0]?.id ?? null;
  const canApply = !!user && !!spotId;

  return (
    <div className="space-y-6">
      <ChartCard title="Try the models on a live spot"
        description="Historical data trains the models; the models then answer questions about spots in the live ParkEase database.">
        <div className="mb-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-5">
          {["Historical data", "Cleaning & features", "Trained models", "Prediction API", "Live ParkEase spot"].map((step, i) => (
            <div key={step} className="rounded-lg border bg-muted/30 px-3 py-2 text-center font-medium">
              <span className="mr-1 text-muted-foreground">{i + 1}.</span>{step}
            </div>
          ))}
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading spots…</p>
        ) : !spots?.length ? (
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "There are no active spots yet." : "You have no listings yet."} List a spot, or load the demo data, to try a prediction.
          </p>
        ) : (
          <Select value={spotId ? String(spotId) : ""} onValueChange={setChoice}>
            <SelectTrigger className="h-10 w-full sm:w-[460px]"><SelectValue placeholder="Choose a spot" /></SelectTrigger>
            <SelectContent>
              {spots.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name} · ₹{s.pricePerHour}/h · {s.totalSlots} spaces</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </ChartCard>

      {spotId && (
        <>
          <div className="rounded-xl border-none bg-card p-5 shadow-md sm:p-6"><AvailabilityForecast spotId={spotId} /></div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <DemandForecast spotId={spotId} />
            <PriceRecommendation spotId={spotId} ownerId={user?.id} canApply={canApply} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model performance
// ---------------------------------------------------------------------------
function ModelsTab() {
  const query = useModelPerformance();
  return (
    <QueryState query={query} skeletonHeight={600}>
      {(data) => (
        <div className="space-y-8">
          <div className="rounded-xl border bg-muted/30 p-4 text-sm">
            <p className="font-semibold">How the models were evaluated</p>
            <p className="mt-1 text-muted-foreground">{data.evaluation_design}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Trained {data.trained_at} · scikit-learn {data.environment.scikit_learn} · random seed {data.random_seed} · {data.notice}
            </p>
          </div>
          <ModelSection report={data.models.availability} kind="availability" />
          <ModelSection report={data.models.demand} kind="demand" />
          <ModelSection report={data.models.price} kind="price" />
          <RecommendationSection data={data} />
        </div>
      )}
    </QueryState>
  );
}

const fmt = (v: number | undefined, digits = 3) => (v === undefined ? "–" : v.toFixed(digits));

function ModelSection({ report, kind }: { report: ModelReport; kind: "availability" | "demand" | "price" }) {
  const t = report.test_metrics;
  const regression = report.problem_type === "regression";
  const columns = regression
    ? ([["mae", "MAE"], ["rmse", "RMSE"], ["r2", "R²"]] as const)
    : ([["accuracy", "Accuracy"], ["precision_macro", "Precision"], ["recall_macro", "Recall"], ["f1_macro", "F1"]] as const);

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">{report.name}</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        {regression ? "Regression" : "Classification"} · target: {report.target} · selected model:{" "}
        <span className="font-semibold text-foreground">{report.selected_model}</span>
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kind === "availability" && (
          <>
            <StatTile label="MAE (test)" value={`${fmt(t.mae, 1)} pts`} hint={`slot-average baseline: ${fmt(report.test_baseline_slot_average?.mae, 1)}`} />
            <StatTile label="RMSE (test)" value={`${fmt(t.rmse, 1)} pts`} />
            <StatTile label="R² (test)" value={fmt(t.r2, 2)} hint="share of variance explained" />
            <StatTile label="Error in spaces" value={`±${fmt(report.test_mae_spaces, 2)}`} hint="mean absolute error" />
          </>
        )}
        {kind === "demand" && (
          <>
            <StatTile label="Accuracy (test)" value={`${((t.accuracy ?? 0) * 100).toFixed(1)}%`} hint={`majority-class baseline: ${((report.test_baseline_majority?.accuracy ?? 0) * 100).toFixed(1)}%`} />
            <StatTile label="Precision (macro)" value={fmt(t.precision_macro, 2)} />
            <StatTile label="Recall (macro)" value={fmt(t.recall_macro, 2)} />
            <StatTile label="F1-score (macro)" value={fmt(t.f1_macro, 2)} hint={`within one level: ${((report.test_within_one_level ?? 0) * 100).toFixed(1)}%`} />
          </>
        )}
        {kind === "price" && (
          <>
            <StatTile label="MAE (test)" value={`₹${fmt(report.test_metrics_rupees?.mae, 2)}/h`} hint={`keep-base-price baseline: ₹${fmt(report.test_baseline_keep_base_price_rupees?.mae, 2)}`} />
            <StatTile label="RMSE (test)" value={`₹${fmt(report.test_metrics_rupees?.rmse, 2)}/h`} />
            <StatTile label="R² of price ratio" value={fmt(t.r2, 2)} hint="price / base price" />
            <StatTile label="MAE as used in the app" value={`₹${fmt(report.test_metrics_with_predicted_demand_rupees?.mae, 2)}/h`} hint="demand from the demand model" />
          </>
        )}
      </div>

      <Grid>
        <ChartCard title="Model comparison" description={`Validation period. Chosen by ${report.selection_metric}.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="rounded-tl-lg px-3 py-2">Model</th>
                  {columns.map(([key, label], i) => (
                    <th key={key} className={`px-3 py-2 text-right ${i === columns.length - 1 ? "rounded-tr-lg" : ""}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.comparison.map((row) => {
                  const selected = row.model === report.selected_model;
                  return (
                    <tr key={row.model} className={`border-b border-border/50 ${selected ? "bg-primary/10 font-semibold" : ""} ${row.baseline ? "text-muted-foreground" : ""}`}>
                      <td className="px-3 py-2">{row.model}{selected && " ✓"}</td>
                      {columns.map(([key]) => (
                        <td key={key} className="px-3 py-2 text-right tabular-nums">{fmt(row[key], kind === "availability" ? 2 : 3)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Train {report.split.train.rows.toLocaleString("en-IN")} rows ({report.split.train.from} to {report.split.train.to}) ·
            validation {report.split.validation.rows.toLocaleString("en-IN")} · test {report.split.test.rows.toLocaleString("en-IN")} ({report.split.test.from} to {report.split.test.to}).
            Excluded: {report.rows_excluded}.
            {kind === "price" && " Errors here are in price-ratio units."}
          </p>
        </ChartCard>

        <ChartCard title="Feature importance" description="How much the test score drops when each feature is shuffled (share of the total).">
          <BarList rows={report.feature_importance.slice(0, 8).map((f) => ({ label: f.label, value: f.share }))} />
        </ChartCard>

        {t.confusion_matrix && (
          <ChartCard title="Confusion matrix" description="Test period. Rows are the actual level, columns the predicted level.">
            <ConfusionMatrix labels={t.confusion_matrix.labels} matrix={t.confusion_matrix.matrix} />
          </ChartCard>
        )}
        {t.per_class && report.class_distribution && (
          <ChartCard title="Per-class results and class distribution" description="Test period.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="rounded-tl-lg px-3 py-2">Class</th>
                    <th className="px-3 py-2 text-right">Precision</th>
                    <th className="px-3 py-2 text-right">Recall</th>
                    <th className="px-3 py-2 text-right">F1</th>
                    <th className="px-3 py-2 text-right">Test share</th>
                    <th className="rounded-tr-lg px-3 py-2 text-right">Train share</th>
                  </tr>
                </thead>
                <tbody>
                  {t.per_class.map((c) => (
                    <tr key={c.label} className="border-b border-border/50">
                      <td className="px-3 py-2 font-medium">{c.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.precision.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.recall.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.f1.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{report.class_distribution!.test[c.label as DemandLevel].share}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{report.class_distribution!.train[c.label as DemandLevel].share}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </Grid>
    </section>
  );
}

function ConfusionMatrix({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <td />
            {labels.map((l) => <th key={l} className="px-2 pb-1 text-xs font-medium text-muted-foreground">Predicted {l}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={labels[i]}>
                <th scope="row" className="whitespace-nowrap pr-2 text-right text-xs font-medium text-muted-foreground">Actual {labels[i]}</th>
                {row.map((count, j) => {
                  const share = count / total;
                  return (
                    <td key={j} className={`h-16 w-24 rounded-md text-center ${i === j ? "ring-2 ring-foreground/30" : ""}`}
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--ds-series-1) ${Math.round(share * 100)}%, var(--ds-zero))`,
                        color: share > 0.55 ? "#fff" : "hsl(var(--foreground))",
                      }}>
                      <div className="font-bold tabular-nums">{count.toLocaleString("en-IN")}</div>
                      <div className="text-[11px] tabular-nums opacity-90">{(share * 100).toFixed(0)}%</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-center text-xs text-muted-foreground">Outlined cells are correct predictions. Percentages are of each actual level.</p>
    </div>
  );
}

function RecommendationSection({ data }: { data: ModelPerformanceResponse }) {
  const weights = data.recommendation.weights;
  const labels: Record<string, string> = {
    availability: "Predicted availability", distance: "Distance", price: "Price", history: "Booking history",
  };
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">Smart parking recommendation</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">A transparent weighted score, not a trained model. It uses the availability model as one of its inputs.</p>
      <Grid>
        <ChartCard title="Score weights" description="Default weights; a driver can change them in the app.">
          <BarList max={100} rows={Object.entries(weights).map(([key, value]) => ({ label: labels[key] ?? key, value: value * 100 }))} />
          <p className="mt-3 text-xs text-muted-foreground">
            Each component is scaled to 0–1 before it is weighted. Distance reaches 0 at {data.recommendation.max_distance_km} km;
            spots beyond {data.recommendation.radius_km} km are not ranked.
          </p>
        </ChartCard>
        <ChartCard title="Price recommendation rules" description="Applied after the price model, so every suggestion can be explained.">
          <ul className="space-y-2 text-sm">
            <li>Suggestions are rounded to steps of ₹{data.price_rules.step}.</li>
            <li>One suggestion never moves the price by more than +{data.price_rules.max_increase * 100}% or −{data.price_rules.max_decrease * 100}%.</li>
            <li>No increase is suggested beyond {data.price_rules.peer_ceiling}x the typical price of similar listings in the zone.</li>
            <li>The owner applies or dismisses every suggestion; prices never change automatically.</li>
          </ul>
        </ChartCard>
      </Grid>
    </section>
  );
}
