/**
 * Calls for the newer ParkEase features that are not part of the generated
 * API client: rewards, booking messages, the parking assistant search and
 * QR entry passes.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/auth-api";

// ---------------------------------------------------------------- rewards
export interface RewardSummary {
  bookingsPerReward: number;
  qualifyingBookings: number;
  earned: number;
  redeemed: number;
  available: number;
  progress: number;
  remaining: number;
}

export const REWARDS_KEY = ["rewards"] as const;

export function useRewards(enabled = true) {
  return useQuery({
    queryKey: REWARDS_KEY,
    queryFn: () => apiRequest<RewardSummary>("/rewards"),
    enabled,
  });
}

// ---------------------------------------------------------- notifications
export interface AppNotification {
  id: number;
  bookingId: number | null;
  kind: "booking_started" | "booking_ended" | "test" | string;
  toEmail: string | null;
  subject: string;
  body: string;
  emailStatus: "sent" | "not_configured" | "skipped_demo" | "failed" | string;
  emailError: string | null;
  createdAt: string;
}

export const notificationsKey = (bookingId?: number) => ["notifications", bookingId ?? "all"] as const;

export function useNotifications(options: { bookingId?: number; enabled?: boolean } = {}) {
  const { bookingId, enabled = true } = options;
  return useQuery({
    queryKey: notificationsKey(bookingId),
    queryFn: () => apiRequest<AppNotification[]>(`/notifications${bookingId ? `?bookingId=${bookingId}` : ""}`),
    enabled,
    // Start and end messages appear on their own, so keep the list fresh.
    refetchInterval: 60_000,
  });
}

export const sendTestEmail = () => apiRequest<AppNotification>("/notifications/test", { method: "POST" });

export function useEmailStatus() {
  return useQuery({
    queryKey: ["notifications", "email-status"],
    queryFn: () => apiRequest<{ configured: boolean; from: string | null }>("/notifications/email-status"),
  });
}

/** What happened to the email of a message, in plain words. */
export function emailStatusText(n: Pick<AppNotification, "emailStatus" | "toEmail" | "emailError">): string {
  switch (n.emailStatus) {
    case "sent":
      return `Emailed to ${n.toEmail}`;
    case "not_configured":
      return "Not emailed: email sending is not set up on this server";
    case "skipped_demo":
      return "Not emailed: demo address";
    case "failed":
      return `Email failed${n.emailError ? `: ${n.emailError}` : ""}`;
    default:
      return n.emailStatus;
  }
}

// -------------------------------------------------------------- assistant
export interface AssistantSpot {
  id: number;
  name: string;
  address: string;
  city: string;
  pricePerHour: string;
  vehicleType: string;
  availableSlots: number;
  totalSlots: number;
  imageUrl?: string | null;
  isLargeFacility?: boolean;
  distanceKm: number;
}

export interface AssistantResult {
  place: { name: string; lat: number; lng: number; source: "browser" | "known_place" | "listing" };
  nearbyKm: number;
  nearbyCount: number;
  spots: AssistantSpot[];
}

export function assistantSearch(params: { q: string; lat?: number; lng?: number; label?: string; vehicleType?: string }) {
  const query = new URLSearchParams({ q: params.q });
  if (params.lat !== undefined && params.lng !== undefined) {
    query.set("lat", String(params.lat));
    query.set("lng", String(params.lng));
  }
  if (params.label) query.set("label", params.label);
  if (params.vehicleType) query.set("vehicleType", params.vehicleType);
  return apiRequest<AssistantResult>(`/assistant/search?${query.toString()}`);
}

// ------------------------------------------------------------- entry pass
export type PassState = "valid" | "checked_in" | "early" | "expired" | "cancelled";

export interface PassCheck {
  valid: boolean;
  state: PassState;
  message: string;
  booking: {
    id: number;
    spotId: number;
    spotName: string;
    driverName: string | null;
    vehicleNumber: string;
    vehicleType: string;
    startTime: string;
    endTime: string;
    slotLabel: string | null;
    status: string;
    checkedInAt: string | null;
  };
}

export const checkPass = (code: string) => apiRequest<PassCheck>(`/bookings/verify/${encodeURIComponent(code.trim())}`);

export const confirmEntry = (code: string) =>
  apiRequest<PassCheck>(`/bookings/verify/${encodeURIComponent(code.trim())}/check-in`, { method: "POST" });

/** The address a QR entry pass opens: the owner's verification page. */
export function passUrl(code: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/verify/${encodeURIComponent(code)}`;
}

// Fields the server returns that the generated client types do not list yet.
export interface SpotExtras {
  isLargeFacility?: boolean;
  directionsQuery?: string | null;
}
export interface BookingExtras {
  verifyCode?: string | null;
  slotLabel?: string | null;
  checkedInAt?: string | null;
  isReward?: boolean;
  paymentMode?: "razorpay" | "simulated" | "reward" | null;
  paymentOrderId?: string | null;
  refundId?: string | null;
  refundError?: string | null;
}

// --------------------------------------------------------------- payments
export interface PaymentConfig {
  mode: "razorpay" | "simulated";
  keyId: string | null;
  currency: string;
  commissionPercent: number;
  refundPolicy: string;
}

export function usePaymentConfig() {
  return useQuery({
    queryKey: ["payments", "config"],
    queryFn: () => apiRequest<PaymentConfig>("/payments/config"),
    staleTime: 5 * 60_000,
  });
}

export interface BookingRequest {
  spotId: number;
  vehicleNumber: string;
  vehicleType: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  totalAmount: string;
  notes?: string;
  useReward?: boolean;
}

export interface CheckoutOrder {
  bookingId: number;
  keyId: string;
  orderId: string;
  amount: number; // paise
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

export const startCheckout = (body: BookingRequest) =>
  apiRequest<CheckoutOrder>("/payments/checkout", { method: "POST", body });

export const verifyPayment = (body: { bookingId: number; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
  apiRequest<Record<string, unknown> & { id: number; slotLabel?: string | null; totalAmount: string }>("/payments/verify", { method: "POST", body });

export const abandonPayment = (bookingId: number, reason: string) =>
  apiRequest<{ released: boolean }>("/payments/abandon", { method: "POST", body: { bookingId, reason } });

export const createBookingDirect = (body: BookingRequest) =>
  apiRequest<Record<string, unknown> & { id: number; slotLabel?: string | null; totalAmount: string; isReward?: boolean; paymentMode?: string }>(
    "/bookings", { method: "POST", body });

export const retryRefund = (bookingId: number) => apiRequest<unknown>(`/bookings/${bookingId}/retry-refund`, { method: "POST" });

// ----------------------------------------------------------------- payouts
export interface Payout {
  id: number;
  ownerId: number;
  amount: string;
  reference: string;
  note: string | null;
  createdAt: string;
}

export interface EarningsSummary {
  ownerId: number;
  ownerName: string;
  ownerEmail: string | null;
  payoutUpi: string | null;
  payoutName: string | null;
  completedPaidBookings: number;
  gross: number;
  commissionPercent: number;
  commission: number;
  net: number;
  paidOut: number;
  balance: number;
  payouts: Payout[];
}

export const EARNINGS_KEY = ["payouts", "summary"] as const;

export function useEarnings(enabled = true) {
  return useQuery({
    queryKey: EARNINGS_KEY,
    queryFn: () => apiRequest<EarningsSummary>("/payouts/summary"),
    enabled,
  });
}

export function useOwnerBalances(enabled = true) {
  return useQuery({
    queryKey: ["payouts", "owners"],
    queryFn: () => apiRequest<Array<Omit<EarningsSummary, "payouts"> & { payoutCount: number }>>("/payouts/owners"),
    enabled,
  });
}

export const savePayoutDetails = (body: { payoutUpi: string; payoutName: string }) =>
  apiRequest<{ payoutUpi: string | null; payoutName: string | null }>("/payouts/details", { method: "PATCH", body });

export const recordPayout = (body: { ownerId: number; amount: number; reference: string; note?: string }) =>
  apiRequest<Payout>("/payouts", { method: "POST", body });
