/**
 * Owner feature 3: Smart Price Recommendation.
 * Suggests a price; the owner decides. Applying it uses the existing
 * "update spot" endpoint, exactly as editing the price by hand would.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSpotQueryKey, getListSpotsQueryKey, useUpdateSpot } from "@workspace/api-client-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, IndianRupee, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SERVICE_HOURS, hourLabel, ownerAnalyticsKey, rupees, usePriceRecommendation, type PriceResponse } from "@/lib/ds-api";
import { ChartCard, DemandBadge, EmptyState, QueryState, SyntheticNote } from "./ChartKit";

interface Props {
  spotId: number | null;
  ownerId?: number;
  canApply: boolean;
}

export function PriceRecommendation({ spotId, ownerId, canApply }: Props) {
  const [hourChoice, setHourChoice] = useState<string>("peak");
  const hour = hourChoice === "peak" ? null : Number(hourChoice);
  const query = usePriceRecommendation(spotId, undefined, hour);

  return (
    <ChartCard
      title="Smart price recommendation"
      description="A suggestion from predicted demand and how similar listings were priced. You decide."
      action={
        <Select value={hourChoice} onValueChange={setHourChoice}>
          <SelectTrigger className="h-9 w-[140px] shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="peak">Busiest hour</SelectItem>
            {SERVICE_HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      <QueryState query={query} skeletonHeight={300} compact>
        {(data) => data.available
          ? <RecommendationBody data={data} ownerId={ownerId} canApply={canApply} />
          : <EmptyState title="No price suggestion" icon={IndianRupee}>{data.reason}</EmptyState>}
      </QueryState>
    </ChartCard>
  );
}

function RecommendationBody({ data, ownerId, canApply }: { data: PriceResponse; ownerId?: number; canApply: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSpot = useUpdateSpot();
  const [dismissed, setDismissed] = useState(false);
  const spotId = data.spot.id as number;
  const Arrow = data.action === "increase" ? ArrowUpRight : data.action === "decrease" ? ArrowDownRight : ArrowRight;

  const applyPrice = (price: number) => {
    updateSpot.mutate(
      { id: spotId, data: { pricePerHour: price.toFixed(2) } },
      {
        onSuccess: () => {
          toast({ title: "Price updated", description: `${data.spot.name} is now ${rupees(price)}/hour.` });
          queryClient.invalidateQueries({ queryKey: ["ds", "price"] });
          queryClient.invalidateQueries({ queryKey: ownerAnalyticsKey(ownerId) });
          queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(spotId) });
          queryClient.invalidateQueries({ queryKey: getListSpotsQueryKey() });
        },
        onError: () => toast({ title: "Could not update the price", description: "Please try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs font-medium text-muted-foreground">Current price</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{rupees(data.current_price)}<span className="text-sm font-medium text-muted-foreground">/hour</span></p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs font-medium text-muted-foreground">Predicted demand at {hourLabel(data.hour)}</p>
          <div className="mt-2"><DemandBadge level={data.predicted_demand} className="text-sm" /></div>
          <p className="mt-1 text-xs text-muted-foreground">{data.hour_basis}</p>
        </div>
        <div className="rounded-xl border-2 border-primary bg-primary/5 p-4">
          <p className="text-xs font-medium text-muted-foreground">Recommended price</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-2xl font-extrabold tabular-nums">
            {rupees(data.recommended_price)}<span className="text-sm font-medium text-muted-foreground">/hour</span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold">
            <Arrow className="h-3.5 w-3.5" />
            {data.action === "keep" ? "Keep the current price" : `${data.change_percent > 0 ? "+" : ""}${data.change_percent.toFixed(0)}% vs current`}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this price?</p>
        <ul className="space-y-1 text-sm">
          {data.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      {data.all_day.recommended_price !== data.recommended_price && (
        <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
          Across the whole day (hours weighted by how busy the zone usually is) the suggestion is{" "}
          <span className="font-semibold">{rupees(data.all_day.recommended_price)}/hour</span>.
        </p>
      )}

      {data.action !== "keep" && !dismissed && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {canApply ? (
            <Button className="font-semibold" disabled={updateSpot.isPending} onClick={() => applyPrice(data.recommended_price)}>
              {updateSpot.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply {rupees(data.recommended_price)}/hour
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Only the owner of this listing can apply a price.</p>
          )}
          <Button variant="outline" onClick={() => setDismissed(true)}>Keep {rupees(data.current_price)}/hour</Button>
        </div>
      )}
      {dismissed && <p className="text-sm text-muted-foreground">Suggestion dismissed. Your price is unchanged.</p>}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          ParkEase never changes your price automatically.{" "}
          <span className="font-semibold text-foreground">Model reliability:</span> {data.reliability.model},
          typical error {rupees(data.reliability.mae_rupees, 1)}/hour on held-out test months.
          Similar listings in {data.spot.zone} typically charge {rupees(data.peer_median_price)}/hour.
        </p>
        <SyntheticNote />
      </div>
    </div>
  );
}
