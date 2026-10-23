import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

/**
 * Razorpay payments (UPI, cards, net banking, wallets).
 *
 * Set in backend/.env:
 *   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
 *   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
 *   PLATFORM_COMMISSION_PERCENT=10        (optional, default 10)
 *
 * Without the two keys the app runs in "simulated" mode: bookings are marked
 * paid without any money moving, and the app says so on screen.
 *
 * Flow (see https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/):
 *   1. the server creates a Razorpay order for the amount it calculated
 *   2. the browser opens Razorpay Checkout with that order
 *   3. Checkout returns payment id, order id and signature
 *   4. the server checks the signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret)
 */
const env = (name: string): string => (process.env[name] ?? "").trim();

export function paymentSettings() {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  const rawCommission = env("PLATFORM_COMMISSION_PERCENT");
  const commission = rawCommission === "" ? 10 : Number(rawCommission);
  return {
    mode: keyId && keySecret ? ("razorpay" as const) : ("simulated" as const),
    keyId,
    keySecret,
    // Only for automated tests against a local stand-in for the Razorpay API.
    apiBase: env("RAZORPAY_API_BASE") || "https://api.razorpay.com/v1",
    commissionPercent: Number.isFinite(commission) && commission >= 0 && commission <= 50 ? commission : 10,
  };
}

export class PaymentError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function razorpay<T>(method: string, path: string, body: unknown): Promise<T> {
  const { keyId, keySecret, apiBase } = paymentSettings();
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    logger.error({ err, path }, "Razorpay could not be reached");
    throw new PaymentError("The payment service could not be reached. Please try again.");
  }
  const data = (await response.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (!response.ok) {
    const description = data?.error?.description ?? `Razorpay returned ${response.status}`;
    logger.error({ status: response.status, description, path }, "Razorpay request failed");
    throw new PaymentError(description, response.status === 401 ? 500 : 502);
  }
  return data;
}

export const toPaise = (rupees: number): number => Math.round(rupees * 100);

export function createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  return razorpay<{ id: string; amount: number; currency: string; status: string }>("POST", "/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  });
}

/** Full refund unless an amount (in paise) is given. Only captured payments can be refunded. */
export function refundPayment(paymentId: string, receipt: string, amountPaise?: number) {
  return razorpay<{ id: string; status: string; amount: number }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
    ...(amountPaise ? { amount: amountPaise } : {}),
    speed: "normal",
    receipt: receipt.slice(0, 40),
  });
}

export function signatureIsValid(orderId: string, paymentId: string, signature: string): boolean {
  const { keySecret } = paymentSettings();
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
