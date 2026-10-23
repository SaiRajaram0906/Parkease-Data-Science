/**
 * Client for the ParkEase Data Science endpoints (/api/analytics, /api/predictions,
 * /api/recommendations, /api/models). Every number shown by the Data Science
 * features comes through here from the backend; nothing is computed or
 * hardcoded in the browser.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { storedToken } from "@/lib/auth-api";

export class DsError extends Error {
  constructor(
    public status: number,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

async function dsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const token = storedToken();
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new DsError(0, "Could not reach the ParkEase server.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let hint: string | undefined;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
      hint = body?.hint;
    } catch {
      // keep the generic message
    }
    throw new DsError(response.status, message, hint);
  }
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const FIVE_MINUTES = 5 * 60 * 1000;
const noRetryOnClientError = (failures: number, error: unknown) =>
  !(error instanceof DsError && error.status >= 400 && error.status < 500) && failures < 1;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------
export type DemandLevel = "Low" | "Medium" | "High";

export interface DescribedSpot {
  id: number | null;
  name: string | null;
  zone: string;
  zone_character: string;
  zone_match: { zone: string; method: "history" | "location" | "price_profile"; detail: string };
  capacity: number;
  price_per_hour: number;
  vehicle_type: string;
  peer_median_price: number;
  price_rel_peers: number;
  history_source: string;
  history_bookings: number;
  completion_rate: number | null;
}

// ---------------------------------------------------------------------------
// Driver: recommendation
// ---------------------------------------------------------------------------
export interface Recommendation {
  rank: number;
  spot_id: number;
  name: string;
  score: number;
  components: Record<ScoreComponent, number>;
  contributions: Partial<Record<ScoreComponent, number>>;
  reasons: string[];
  cautions: string[];
  predicted_free_percent: number;
  predicted_occupancy: number;
  available_low: number;
  available_high: number;
  prediction_method: "model" | "zone_baseline";
  current_available: number | null;
  capacity: number;
  distance_km: number | null;
  price_per_hour: number;
  zone: string;
  zone_match: string;
  completion_rate: number | null;
  address: string | null;
  city: string | null;
  image_url: string | null;
  vehicle_type: string | null;
}
export type ScoreComponent = "availability" | "distance" | "price" | "history";
export interface RecommendationResponse {
  recommendations: Recommendation[];
  candidates: number;
  excluded: Record<string, number>;
  weights: Record<ScoreComponent, number>;
  max_distance_km?: number;
  hour: number;
  hour_label?: string;
  date: string;
  formula?: string;
  has_origin: boolean;
  is_today: boolean;
}
export interface RecommendationParams {
  lat?: number | null;
  lng?: number | null;
  vehicleType?: string;
  date?: string;
  hour?: number | null;
  limit?: number;
  weights?: Partial<Record<ScoreComponent, number>>;
}
export function useParkingRecommendations(
  params: RecommendationParams,
  enabled = true,
): UseQueryResult<RecommendationResponse, DsError> {
  const q = query({
    lat: params.lat, lng: params.lng, vehicleType: params.vehicleType, date: params.date,
    hour: params.hour, limit: params.limit,
    wAvailability: params.weights?.availability, wDistance: params.weights?.distance,
    wPrice: params.weights?.price, wHistory: params.weights?.history,
  });
  return useQuery<RecommendationResponse, DsError>({
    queryKey: ["ds", "recommendations", q],
    queryFn: () => dsFetch<RecommendationResponse>(`/recommendations/parking${q}`),
    enabled, staleTime: 60_000, retry: noRetryOnClientError,
    // Keep showing the previous ranking while a changed request loads.
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------
// Driver: availability prediction
// ---------------------------------------------------------------------------
export interface AvailabilityHour {
  hour: number;
  label: string;
  available: boolean;
  reason?: string;
  method?: "model" | "zone_baseline";
  predicted_occupancy?: number;
  occupancy_low?: number;
  occupancy_high?: number;
  predicted_free_share?: number;
  predicted_available?: number;
  available_low?: number;
  available_high?: number;
}
export interface AvailabilityResponse {
  spot: DescribedSpot;
  date: string;
  capacity: number;
  hours: AvailabilityHour[];
  focus_hour: number;
  is_today: boolean;
  current_hour: number;
  live: { date: string; hour: number; total_slots: number; booked: number; available: number; source: string };
  reliability: {
    model: string; mae_occupancy_points: number; mae_spaces: number; r2: number;
    interval_coverage: number; note: string;
  };
}
export function useAvailabilityPrediction(spotId: number | null, date?: string, hour?: number | null) {
  const q = query({ spotId, date, hour });
  return useQuery<AvailabilityResponse, DsError>({
    queryKey: ["ds", "availability", q],
    queryFn: () => dsFetch<AvailabilityResponse>(`/predictions/availability${q}`),
    enabled: !!spotId, staleTime: 60_000, retry: noRetryOnClientError,
  });
}

// ---------------------------------------------------------------------------
// Owner: demand forecast
// ---------------------------------------------------------------------------
export interface DemandHour {
  hour: number;
  label: string;
  available: boolean;
  level?: DemandLevel;
  confidence?: number;
  probabilities?: Record<DemandLevel, number>;
  demand_score?: number;
}
export interface DemandResponse {
  spot: DescribedSpot;
  date: string;
  hours: DemandHour[];
  peak: DemandHour | null;
  is_today: boolean;
  current_hour: number;
  reliability: { model: string; accuracy: number; f1_macro: number; within_one_level: number; note: string };
}
export function useDemandForecast(spotId: number | null, date?: string) {
  const q = query({ spotId, date });
  return useQuery<DemandResponse, DsError>({
    queryKey: ["ds", "demand", q],
    queryFn: () => dsFetch<DemandResponse>(`/predictions/demand${q}`),
    enabled: !!spotId, staleTime: FIVE_MINUTES, retry: noRetryOnClientError,
  });
}

// ---------------------------------------------------------------------------
// Owner: price recommendation
// ---------------------------------------------------------------------------
export interface PriceResponse {
  available: boolean;
  reason?: string;
  spot: DescribedSpot;
  date: string;
  hour: number;
  hour_label: string;
  hour_basis: string;
  current_price: number;
  predicted_demand: DemandLevel;
  demand_probabilities: Record<DemandLevel, number>;
  market_ratio: number;
  recommended_price: number;
  action: "increase" | "decrease" | "keep";
  change_percent: number;
  rules_applied: string[];
  reasons: string[];
  peer_median_price: number;
  price_vs_peers: number;
  all_day: { market_ratio: number; recommended_price: number; action: string };
  by_hour: { hour: number; label: string; demand: DemandLevel; confidence: number; market_ratio: number; recommended_price: number; action: string }[];
  reliability: { model: string; mae_rupees: number; mae_ratio: number; note: string };
}
export const priceRecommendationKey = (spotId: number | null, date?: string, hour?: number | null) =>
  ["ds", "price", query({ spotId, date, hour })];
export function usePriceRecommendation(spotId: number | null, date?: string, hour?: number | null) {
  const q = query({ spotId, date, hour });
  return useQuery<PriceResponse, DsError>({
    queryKey: ["ds", "price", q],
    queryFn: () => dsFetch<PriceResponse>(`/recommendations/price${q}`),
    enabled: !!spotId, staleTime: 60_000, retry: noRetryOnClientError,
  });
}

// ---------------------------------------------------------------------------
// Driver and owner analytics
// ---------------------------------------------------------------------------
export interface DriverAnalyticsResponse {
  has_data: boolean;
  total_bookings: number;
  completed_bookings?: number;
  cancelled_bookings?: number;
  avg_duration_hours?: number;
  avg_spending?: number;
  total_spending?: number;
  most_used_zone?: string;
  preferred_time?: string;
  preferred_hour?: number;
  first_booking?: string;
  last_booking?: string;
  by_month?: { month: string; label: string; bookings: number; spending: number; avg_spending: number | null; avg_duration: number | null }[];
  by_zone?: { zone: string; bookings: number }[];
  by_time_of_day?: { period: string; bookings: number }[];
  source: "history" | "live";
  synthetic_data: boolean;
  linked: boolean;
  user: { id: number; name: string; role: string; liveBookings: number };
}
export function useDriverAnalytics(userId: number | undefined) {
  return useQuery<DriverAnalyticsResponse, DsError>({
    queryKey: ["ds", "driver-analytics", userId],
    queryFn: () => dsFetch<DriverAnalyticsResponse>(`/analytics/driver/${userId}`),
    enabled: !!userId, staleTime: 60_000, retry: noRetryOnClientError,
  });
}

export interface OwnerSpot {
  id: number; name: string; city: string; pricePerHour: number; totalSlots: number;
  vehicleType: string; isActive: boolean; datasetSlotId: string | null;
}
export interface OwnerAnalyticsResponse {
  has_data: boolean;
  listings: number;
  total_bookings: number;
  completed_revenue?: number;
  occupancy_rate?: number | null;
  avg_duration_hours?: number;
  peak_hour?: number;
  peak_hour_label?: string;
  cancellation_rate?: number | null;
  revenue_by_month?: { month: string; label: string; revenue: number; bookings: number; occupancy: number | null }[];
  bookings_by_hour?: { hour: number; label: string; bookings: number }[];
  status_distribution?: { status: string; bookings: number; share: number }[];
  by_slot: { slot_id: string; spot_id: number | null; name: string; zone: string; bookings: number; completed_revenue: number; occupancy: number | null; cancellation_rate: number | null }[];
  source: "history" | "live";
  synthetic_data: boolean;
  linked: boolean;
  spots: OwnerSpot[];
  user: { id: number; name: string; role: string };
}
export const ownerAnalyticsKey = (userId: number | undefined) => ["ds", "owner-analytics", userId];
export function useOwnerAnalytics(userId: number | undefined) {
  return useQuery<OwnerAnalyticsResponse, DsError>({
    queryKey: ownerAnalyticsKey(userId),
    queryFn: () => dsFetch<OwnerAnalyticsResponse>(`/analytics/owner/${userId}`),
    enabled: !!userId, staleTime: 60_000, retry: noRetryOnClientError,
  });
}

// ---------------------------------------------------------------------------
// Dataset EDA, data quality and model performance
// ---------------------------------------------------------------------------
export interface ZoneRow {
  zone: string; bookings: number; listings: number; occupancy: number; avg_price: number;
  avg_duration: number; avg_distance: number; high_demand_share: number;
  cancellation_rate: number; completed_revenue: number;
}
export interface OverviewResponse {
  notice: string;
  totals: {
    users: number; drivers: number; owners: number; listings: number; active_listings: number;
    bookings: number; completed_revenue: number; avg_occupancy: number; cancellation_rate: number;
    date_from: string; date_to: string;
  };
  summary_statistics: { column: string; label: string; count: number; mean: number; median: number; std: number; min: number; q1: number; q3: number; max: number; skew: number }[];
  bookings_by_hour: { hour: number; label: string; weekday: number; weekend: number; weekday_occupancy: number; weekend_occupancy: number }[];
  bookings_by_day_of_week: { day: string; short: string; bookings: number; per_day: number }[];
  monthly_trend: { month: string; label: string; bookings: number; completed_revenue: number; active_drivers: number }[];
  zones: ZoneRow[];
  demand_distribution: { level: string; bookings: number; share: number; occupancy?: number; avg_price?: number; price_vs_base?: number; cancellation_rate?: number }[];
  price_vs_demand: { points: { base_price: number; price: number; level: DemandLevel; occupancy: number }[]; sampled_from: number; spearman_demand_price: number; spearman_demand_price_ratio: number };
  distance_vs_cancellation: { band: string; bookings: number; cancellation_rate: number }[];
  status_distribution: { status: string; bookings: number; share: number }[];
  correlation: { labels: string[]; cells: { x: string; y: string; value: number }[]; method: string };
  user_behaviour: {
    bookings_per_driver: { band: string; drivers: number }[];
    drivers_with_bookings: number; drivers_total: number;
    median_bookings_per_driver: number; mean_bookings_per_driver: number;
    duration_distribution: { hours: number; bookings: number }[];
    vehicle_mix: { vehicle: string; drivers: number; bookings: number }[];
  };
  price_elasticity: { spearman: number; bands: { band: string; listings: number; relative_bookings: number }[] };
  insights: string[];
}
export function useParkingOverview() {
  return useQuery<OverviewResponse, DsError>({
    queryKey: ["ds", "overview"],
    queryFn: () => dsFetch<OverviewResponse>("/analytics/parking-overview"),
    staleTime: Infinity, retry: noRetryOnClientError,
  });
}

export interface DataQualityResponse {
  validation: {
    checks_total: number; checks_passed: number; checks_failed: number; all_passed: boolean;
    checks: { group: string; name: string; violations: number; passed: boolean; detail: string }[];
    missing_values: { table: string; column: string; missing: number; percent: number; expected: boolean }[];
    files: Record<string, { rows: number; columns: number }>;
  };
  cleaning: {
    missing_before: Record<string, Record<string, number>>;
    missing_after: Record<string, Record<string, number>>;
    bookings: { demand_level: { missing_before: number; filled_from_same_slot_hour: number; left_missing: number } };
  } | null;
}
export function useDataQuality() {
  return useQuery<DataQualityResponse, DsError>({
    queryKey: ["ds", "data-quality"],
    queryFn: () => dsFetch<DataQualityResponse>("/analytics/data-quality"),
    staleTime: Infinity, retry: noRetryOnClientError,
  });
}

export interface ModelComparisonRow {
  model: string; baseline: boolean;
  mae?: number; rmse?: number; r2?: number;
  accuracy?: number; precision_macro?: number; recall_macro?: number; f1_macro?: number;
}
export interface FeatureImportanceRow { feature: string; label: string; importance: number; share: number }
export interface ModelReport {
  name: string;
  problem_type: "regression" | "classification";
  target: string;
  features: string[];
  rows_excluded: string;
  split: Record<"train" | "validation" | "test", { rows: number; from: string; to: string }>;
  selection_metric: string;
  comparison: ModelComparisonRow[];
  selected_model: string;
  test_metrics: {
    mae?: number; rmse?: number; r2?: number;
    accuracy?: number; precision_macro?: number; recall_macro?: number; f1_macro?: number; f1_weighted?: number;
    per_class?: { label: string; precision: number; recall: number; f1: number; support: number }[];
    confusion_matrix?: { labels: string[]; matrix: number[][] };
  };
  feature_importance: FeatureImportanceRow[];
  test_mae_spaces?: number;
  test_baseline_slot_average?: { mae: number; rmse: number; r2: number };
  prediction_interval?: { coverage: number; lower: number; upper: number };
  test_baseline_majority?: { accuracy: number; f1_macro: number };
  test_within_one_level?: number;
  class_distribution?: Record<"train" | "test", Record<DemandLevel, { count: number; share: number }>>;
  test_metrics_rupees?: { mae: number; rmse: number; r2: number };
  test_baseline_keep_base_price_rupees?: { mae: number; rmse: number; r2: number };
  test_metrics_with_predicted_demand?: { mae: number; rmse: number; r2: number };
  test_metrics_with_predicted_demand_rupees?: { mae: number; rmse: number; r2: number };
}
export interface ModelPerformanceResponse {
  notice: string;
  trained_at: string;
  random_seed: number;
  environment: { python: string; scikit_learn: string };
  evaluation_design: string;
  models: { availability: ModelReport; demand: ModelReport; price: ModelReport };
  recommendation: { type: string; weights: Record<ScoreComponent, number>; max_distance_km: number; radius_km: number };
  price_rules: { step: number; max_increase: number; max_decrease: number; peer_ceiling: number };
}
export function useModelPerformance() {
  return useQuery<ModelPerformanceResponse, DsError>({
    queryKey: ["ds", "model-performance"],
    queryFn: () => dsFetch<ModelPerformanceResponse>("/models/performance"),
    staleTime: Infinity, retry: noRetryOnClientError,
  });
}

export interface SeedDemoResponse { usersCreated: number; spotsCreated: number; linkedListings: number; note: string }
export const seedDemoData = () => dsFetch<SeedDemoResponse>("/datascience/seed-demo", { method: "POST" });

// ---------------------------------------------------------------------------
// Small helpers shared by the components
// ---------------------------------------------------------------------------
export const SERVICE_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 - 23:00

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

/** Today's date (YYYY-MM-DD) in Indian local time, the time the models use. */
export function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function currentHourInIndia(): number {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
}

export const rupees = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? "–"
    : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
