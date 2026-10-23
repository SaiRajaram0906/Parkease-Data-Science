/**
 * Owner section of the dashboard: slot performance, demand forecast and
 * price recommendation for the logged-in owner's listings.
 */
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOwnerAnalytics } from "@/lib/ds-api";
import { QueryState } from "./ChartKit";
import { DemandForecast } from "./DemandForecast";
import { PriceRecommendation } from "./PriceRecommendation";
import { SlotPerformance } from "./SlotPerformance";

export function OwnerInsights({ userId }: { userId: number | undefined }) {
  const query = useOwnerAnalytics(userId);
  const spots = query.data?.spots ?? [];
  const [spotId, setSpotId] = useState<number | null>(null);

  useEffect(() => {
    if (spots.length && !spots.some((s) => s.id === spotId)) setSpotId(spots[0].id);
  }, [spots, spotId]);

  return (
    <QueryState query={query} skeletonHeight={420}>
      {(data) => (
        <Tabs defaultValue="performance">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto w-full flex-wrap justify-start lg:w-auto">
              <TabsTrigger value="performance">Slot performance</TabsTrigger>
              <TabsTrigger value="forecast" disabled={!data.spots.length}>Demand &amp; pricing</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="performance"><SlotPerformance data={data} /></TabsContent>

          <TabsContent value="forecast" className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm font-medium">Listing</span>
              <Select value={spotId ? String(spotId) : ""} onValueChange={(v) => setSpotId(Number(v))}>
                <SelectTrigger className="h-10 w-full sm:w-[420px]"><SelectValue placeholder="Choose a listing" /></SelectTrigger>
                <SelectContent>
                  {data.spots.map((spot) => (
                    <SelectItem key={spot.id} value={String(spot.id)}>
                      {spot.name} · ₹{spot.pricePerHour}/h{spot.isActive ? "" : " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <DemandForecast spotId={spotId} />
              <PriceRecommendation spotId={spotId} ownerId={userId} canApply />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </QueryState>
  );
}
