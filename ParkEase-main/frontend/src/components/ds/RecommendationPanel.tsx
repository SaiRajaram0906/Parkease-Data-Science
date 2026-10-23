/**
 * Driver feature 1: Smart Parking Recommendation.
 * Ranks live spots with a transparent score and shows the reasoning.
 */
import { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, Car, Check, Clock, MapPin, Navigation, SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  SERVICE_HOURS, currentHourInIndia, hourLabel, rupees, useParkingRecommendations,
  type Recommendation, type ScoreComponent,
} from "@/lib/ds-api";
import { ActualTag, EmptyState, PredictionTag, QueryState, SyntheticNote } from "./ChartKit";

const COMPONENT_LABEL: Record<ScoreComponent, string> = {
  availability: "Predicted availability",
  distance: "Distance",
  price: "Price",
  history: "Booking history",
};
const COMPONENT_ORDER: ScoreComponent[] = ["availability", "distance", "price", "history"];

interface Props {
  origin: { lat: number; lng: number } | null;
  originLabel: string;
  vehicleType: string;
}

export function RecommendationPanel({ origin, originLabel, vehicleType }: Props) {
  const nowHour = currentHourInIndia();
  const [hourChoice, setHourChoice] = useState<string>("now");
  const [useDistance, setUseDistance] = useState(true);
  const [customWeights, setCustomWeights] = useState<Record<ScoreComponent, number> | null>(null);

  const hour = hourChoice === "now" ? null : Number(hourChoice);
  const activeOrigin = useDistance ? origin : null;
  const query = useParkingRecommendations({
    lat: activeOrigin?.lat, lng: activeOrigin?.lng,
    vehicleType: vehicleType === "all" ? undefined : vehicleType,
    hour, limit: 3, weights: customWeights ?? undefined,
  });

  return (
    <section className="mb-10" aria-label="Smart parking recommendations">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart recommendations
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked by predicted availability, distance, price and booking history
            {activeOrigin ? ` from ${originLabel}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={hourChoice} onValueChange={setHourChoice}>
            <SelectTrigger className="h-9 w-[180px]">
              <Clock className="mr-1.5 h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="now">Now ({hourLabel(nowHour)})</SelectItem>
              {SERVICE_HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>Today {hourLabel(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <WeightsPopover
            weights={customWeights ?? query.data?.weights ?? null}
            isCustom={customWeights !== null}
            onChange={setCustomWeights}
          />
        </div>
      </div>

      <QueryState query={query} skeletonHeight={260}>
        {(data) => {
          if (data.recommendations.length === 0) {
            const tooFar = data.excluded?.too_far ?? 0;
            const noPrediction = data.excluded?.no_prediction ?? 0;
            return (
              <EmptyState title="No recommendation for this request">
                {noPrediction > 0 ? (
                  <p>
                    Predictions cover parking that starts between 6:00 AM and 11:00 PM, the hours
                    present in the booking history. Pick a time in that range.
                  </p>
                ) : tooFar > 0 && activeOrigin ? (
                  <>
                    <p>None of the {tooFar} matching spots is within 5 km of {originLabel}.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setUseDistance(false)}>
                      Rank all spots without distance
                    </Button>
                  </>
                ) : (
                  <p>No active spot matches this vehicle type and time.</p>
                )}
              </EmptyState>
            );
          }
          return (
            <>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {data.recommendations.map((item) => (
                  <RecommendationCard key={item.spot_id} item={item} weights={data.weights} hourText={hourLabel(data.hour)} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Score = {COMPONENT_ORDER.filter((c) => (data.weights[c] ?? 0) > 0)
                    .map((c) => `${Math.round(data.weights[c] * 100)}% ${COMPONENT_LABEL[c].toLowerCase()}`).join(" + ")}
                  . {data.candidates} spots compared for {hourLabel(data.hour)}.
                </span>
                {!activeOrigin && (
                  origin ? (
                    <button className="underline" onClick={() => setUseDistance(true)}>Use distance from {originLabel}</button>
                  ) : (
                    <span>Allow location access or search an area to include distance.</span>
                  )
                )}
                <SyntheticNote />
              </div>
            </>
          );
        }}
      </QueryState>
    </section>
  );
}

function RecommendationCard({
  item, weights, hourText,
}: { item: Recommendation; weights: Record<ScoreComponent, number>; hourText: string }) {
  const best = item.rank === 1;
  return (
    <Card className={`flex h-full flex-col overflow-hidden ${best ? "border-2 border-primary shadow-lg" : "border-border/60"}`}>
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge variant={best ? "default" : "secondary"} className="mb-2 uppercase tracking-wide">
              {best ? "Best match" : `#${item.rank}`}
            </Badge>
            <h3 className="font-bold leading-snug line-clamp-2">{item.name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.address}{item.city ? `, ${item.city}` : ""}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-3xl font-extrabold leading-none tabular-nums">{Math.round(item.score)}</div>
            <div className="text-[11px] text-muted-foreground">out of 100</div>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center text-xs">
          <div>
            <dt className="text-muted-foreground">Predicted free</dt>
            <dd className="mt-0.5 text-sm font-bold">{item.predicted_free_percent}%</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Distance</dt>
            <dd className="mt-0.5 text-sm font-bold">{item.distance_km === null ? "–" : `${item.distance_km.toFixed(1)} km`}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Price</dt>
            <dd className="mt-0.5 text-sm font-bold">{rupees(item.price_per_hour)}/h</dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <PredictionTag>Predicted at {hourText}</PredictionTag>
          <span className="text-muted-foreground">
            {item.available_low === item.available_high ? item.available_low : `${item.available_low}–${item.available_high}`} of {item.capacity} spaces
          </span>
        </div>
        {item.current_available !== null && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <ActualTag>Not booked at {hourText}</ActualTag>
            <span className="text-muted-foreground">{item.current_available} of {item.capacity} spaces</span>
          </div>
        )}

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why recommended?</p>
          <ul className="space-y-1 text-sm">
            {item.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{reason}</span>
              </li>
            ))}
            {item.cautions.map((caution) => (
              <li key={caution} className="flex items-start gap-2 text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{caution}</span>
              </li>
            ))}
            {item.reasons.length === 0 && item.cautions.length === 0 && (
              <li className="text-muted-foreground">A balanced option: no single factor stands out.</li>
            )}
          </ul>
        </div>

        <div className="mt-4 space-y-1.5">
          {COMPONENT_ORDER.filter((c) => (weights[c] ?? 0) > 0).map((component) => {
            const points = item.contributions[component] ?? 0;
            const possible = weights[component] * 100;
            return (
              <div key={component} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-[120px] shrink-0 truncate">{COMPONENT_LABEL[component]}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[var(--ds-series-1)]" style={{ width: `${possible ? (points / possible) * 100 : 0}%` }} />
                </div>
                <span className="w-[52px] shrink-0 text-right tabular-nums">{points.toFixed(0)} / {possible.toFixed(0)}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-auto pt-4">
          <Link href={`/spots/${item.spot_id}`}>
            <Button className="w-full font-semibold" variant={best ? "default" : "outline"}>
              <Navigation className="mr-2 h-4 w-4" />
              View &amp; book
            </Button>
          </Link>
          <p className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center"><MapPin className="mr-0.5 h-3 w-3" />{item.zone}</span>
            <span className="inline-flex items-center"><Car className="mr-0.5 h-3 w-3" />{item.vehicle_type === "both" ? "Car & bike" : item.vehicle_type === "bike" ? "Bike" : "Car"}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeightsPopover({
  weights, isCustom, onChange,
}: {
  weights: Record<ScoreComponent, number> | null;
  isCustom: boolean;
  onChange: (weights: Record<ScoreComponent, number> | null) => void;
}) {
  const applied = weights ?? { availability: 0.4, distance: 0.3, price: 0.2, history: 0.1 };
  // The sliders move freely; the ranking is requested once a slider is released.
  const [draft, setDraft] = useState<Record<ScoreComponent, number> | null>(null);
  const current = draft ?? applied;
  return (
    <Popover onOpenChange={(open) => !open && setDraft(null)}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Priorities{isCustom ? " (custom)" : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-semibold">What matters most to you?</p>
        <p className="mb-3 text-xs text-muted-foreground">The score is recalculated with your weights.</p>
        <div className="space-y-4">
          {COMPONENT_ORDER.map((component) => (
            <div key={component}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span>{COMPONENT_LABEL[component]}</span>
                <span className="tabular-nums text-muted-foreground">{Math.round((current[component] ?? 0) * 100)}</span>
              </div>
              <Slider
                value={[Math.round((current[component] ?? 0) * 100)]}
                min={0} max={100} step={5}
                onValueChange={([value]) => setDraft({ ...current, [component]: value / 100 })}
                onValueCommit={([value]) => { setDraft(null); onChange({ ...current, [component]: value / 100 }); }}
                aria-label={COMPONENT_LABEL[component]}
              />
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-3 w-full" disabled={!isCustom} onClick={() => onChange(null)}>
          Reset to default weights
        </Button>
      </PopoverContent>
    </Popover>
  );
}
