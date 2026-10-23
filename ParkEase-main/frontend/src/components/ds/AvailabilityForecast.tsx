/**
 * Driver feature 2: Parking Availability Prediction.
 * Shows the actual live figure and the model's prediction side by side,
 * clearly labelled, with the model's typical error.
 */
import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_HOURS, currentHourInIndia, hourLabel, useAvailabilityPrediction, type AvailabilityResponse } from "@/lib/ds-api";
import { ActualTag, ChartBox, Legend, PredictionTag, QueryState, SERIES, SyntheticNote, axisTick, gridStroke, tooltipStyle } from "./ChartKit";

export function AvailabilityForecast({ spotId }: { spotId: number }) {
  const nowHour = currentHourInIndia();
  const [hourChoice, setHourChoice] = useState<string>("now");
  const hour = hourChoice === "now" ? null : Number(hourChoice);
  const query = useAvailabilityPrediction(spotId, undefined, hour);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Activity className="h-5 w-5 text-primary" />
          Availability forecast
        </h2>
        <Select value={hourChoice} onValueChange={setHourChoice}>
          <SelectTrigger className="h-9 w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="now">Now ({hourLabel(nowHour)})</SelectItem>
            {SERVICE_HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>Today {hourLabel(h)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <QueryState query={query} skeletonHeight={320}>
        {(data) => <ForecastBody data={data} />}
      </QueryState>
    </div>
  );
}

function ForecastBody({ data }: { data: AvailabilityResponse }) {
  const focus = data.hours.find((h) => h.hour === data.focus_hour);
  const predicted = data.hours.filter((h) => h.available);
  const chartRows = predicted.map((h) => ({
    label: h.label.slice(0, 2),
    hour: h.hour,
    occupancy: h.predicted_occupancy,
    range: [h.occupancy_low, h.occupancy_high] as [number, number],
  }));
  const usesBaseline = predicted.some((h) => h.method === "zone_baseline");
  const focusText = hourLabel(data.focus_hour);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <ActualTag>Actual · live bookings</ActualTag>
          <p className="mt-2 text-sm text-muted-foreground">Not booked at {focusText}</p>
          <p className="text-3xl font-extrabold tabular-nums">
            {data.live.available}
            <span className="ml-1.5 text-base font-medium text-muted-foreground">of {data.live.total_slots} spaces</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Counts ParkEase bookings only.</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <PredictionTag>Model prediction</PredictionTag>
          {focus?.available ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">Expected free at {focusText}</p>
              <p className="text-3xl font-extrabold tabular-nums">
                {focus.available_low === focus.available_high ? focus.available_low : `${focus.available_low}–${focus.available_high}`}
                <span className="ml-1.5 text-base font-medium text-muted-foreground">of {data.capacity} spaces</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Predicted occupancy {focus.predicted_occupancy?.toFixed(0)}% (range {focus.occupancy_low?.toFixed(0)}–{focus.occupancy_high?.toFixed(0)}%).
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold">No prediction for {focusText}</p>
              <p className="mt-1 text-xs text-muted-foreground">{focus?.reason ?? "This hour is outside the booking history."}</p>
            </>
          )}
        </div>
      </div>

      {chartRows.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm font-semibold">Predicted occupancy through the day</p>
          <p className="mb-2 text-xs text-muted-foreground">Share of spaces expected to be taken at each hour, with the usual error range.</p>
          <Legend items={[
            { label: "Predicted occupancy", color: SERIES[0] },
            { label: `Range covering ${Math.round(data.reliability.interval_coverage * 100)}% of test predictions`, color: "var(--ds-band)" },
          ]} />
          <ChartBox height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) => `${label}:00`}
                  formatter={(value, name) =>
                    Array.isArray(value)
                      ? [`${Number(value[0]).toFixed(0)}–${Number(value[1]).toFixed(0)}%`, "Range"]
                      : [`${Number(value).toFixed(0)}%`, name === "occupancy" ? "Predicted occupancy" : String(name)]
                  }
                />
                <Area dataKey="range" stroke="none" fill="var(--ds-band)" isAnimationActive={false} />
                <Line dataKey="occupancy" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                {data.is_today && chartRows.some((r) => r.hour === data.current_hour) && (
                  <ReferenceLine
                    x={String(data.current_hour).padStart(2, "0")}
                    stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4"
                    label={{ value: "Now", position: "top", fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>
      )}

      <div className="rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-semibold text-foreground">Model reliability:</span>{" "}
          {data.reliability.model}, typical error ±{data.reliability.mae_spaces.toFixed(1)} spaces
          ({data.reliability.mae_occupancy_points.toFixed(1)} occupancy points, R² {data.reliability.r2.toFixed(2)}) on held-out test months.
        </p>
        <p>
          <span className="font-semibold text-foreground">Based on:</span>{" "}
          {data.spot.zone} ({data.spot.zone_character.toLowerCase()}), {data.spot.zone_match.detail}.
          {usesBaseline && " Single-space listings use the zone's historical average instead of the model."}
        </p>
        <SyntheticNote />
      </div>
    </div>
  );
}
