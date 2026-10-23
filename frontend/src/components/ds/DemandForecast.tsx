/**
 * Owner feature 1: Demand Prediction.
 * Low / Medium / High demand for each hour of a day, for one listing.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { hourLabel, useDemandForecast, type DemandHour, type DemandLevel, type DemandResponse } from "@/lib/ds-api";
import { ChartBox, ChartCard, DEMAND_COLOR, DemandBadge, Legend, QueryState, SyntheticNote, axisTick, gridStroke, tooltipCursor, tooltipStyle } from "./ChartKit";

const LEVEL_HEIGHT: Record<DemandLevel, number> = { Low: 1, Medium: 2, High: 3 };
const LEVELS: DemandLevel[] = ["Low", "Medium", "High"];

export function DemandForecast({ spotId, date }: { spotId: number | null; date?: string }) {
  const query = useDemandForecast(spotId, date);
  return (
    <ChartCard
      title="Demand forecast"
      description="Predicted demand for this listing at each hour of the day."
      action={<TrendingUp className="h-5 w-5 shrink-0 text-primary" />}
    >
      <QueryState query={query} skeletonHeight={300} compact>
        {(data) => <ForecastBody data={data} />}
      </QueryState>
    </ChartCard>
  );
}

function ForecastBody({ data }: { data: DemandResponse }) {
  const hours = data.hours.filter((h): h is DemandHour & { level: DemandLevel } => h.available && !!h.level);
  const rows = hours.map((h) => ({
    label: h.label.slice(0, 2), hour: h.hour, level: h.level,
    height: LEVEL_HEIGHT[h.level], confidence: h.confidence ?? 0,
  }));
  const highHours = hours.filter((h) => h.level === "High");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-muted-foreground">{data.is_today ? "Today" : data.date}</span>
        {data.peak?.level && (
          <span className="inline-flex items-center gap-2">
            Busiest hour: <span className="font-semibold">{hourLabel(data.peak.hour)}</span>
            <DemandBadge level={data.peak.level} />
          </span>
        )}
        <span className="text-muted-foreground">
          {highHours.length ? `${highHours.length} high-demand hour${highHours.length > 1 ? "s" : ""}` : "No high-demand hours predicted"}
        </span>
      </div>

      <Legend items={LEVELS.map((level) => ({ label: level, color: DEMAND_COLOR[level] }))} />
      <ChartBox height={200}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
            <YAxis
              domain={[0, 3]} ticks={[1, 2, 3]} tickLine={false} axisLine={false} tick={axisTick} width={62}
              tickFormatter={(v) => LEVELS[Number(v) - 1] ?? ""}
            />
            <Tooltip
              contentStyle={tooltipStyle} cursor={tooltipCursor}
              labelFormatter={(label) => `${label}:00`}
              formatter={(_value, _name, item) => [
                `${item.payload.level} (${Math.round(item.payload.confidence * 100)}% likely)`, "Demand",
              ]}
            />
            <Bar dataKey="height" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.hour} fill={DEMAND_COLOR[row.level]}
                  stroke={data.is_today && row.hour === data.current_hour ? "hsl(var(--foreground))" : undefined}
                  strokeWidth={data.is_today && row.hour === data.current_hour ? 2 : 0} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartBox>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
        {hours.filter((h) => h.hour % 2 === 0).map((h) => (
          <div key={h.hour} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
            <span className="tabular-nums text-muted-foreground">{h.label}</span>
            <span className="inline-flex items-center gap-1 font-medium">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DEMAND_COLOR[h.level] }} />
              {h.level}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">Model reliability:</span>{" "}
          {data.reliability.model}, {Math.round(data.reliability.accuracy * 100)}% accuracy
          (macro-F1 {data.reliability.f1_macro.toFixed(2)}) on held-out test months;{" "}
          {Math.round(data.reliability.within_one_level * 100)}% of predictions were within one level.
        </p>
        <p>
          Based on {data.spot.zone} ({data.spot.zone_character.toLowerCase()}) and{" "}
          {data.spot.history_bookings > 0
            ? `this listing's ${data.spot.history_bookings} past bookings`
            : "similar listings, because this listing has no history yet"}.
        </p>
        <SyntheticNote />
      </div>
    </div>
  );
}
