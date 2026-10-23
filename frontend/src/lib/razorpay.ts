/**
 * Razorpay Checkout in the browser.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 */
import type { CheckoutOrder } from "@/lib/app-api";

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
    };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        reject(new Error("Razorpay Checkout could not be loaded. Check your internet connection."));
      };
      document.body.appendChild(script);
    });
  }
  return loading;
}

export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type CheckoutResult =
  | { status: "paid"; response: CheckoutSuccess }
  | { status: "dismissed" }
  | { status: "failed"; reason: string };

/** Opens Razorpay Checkout for an order made by the server and waits for the outcome. */
export async function openRazorpay(order: CheckoutOrder, color: string): Promise<CheckoutResult> {
  await loadScript();
  return new Promise<CheckoutResult>((resolve) => {
    let failure: string | null = null;
    const checkout = new window.Razorpay!({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color },
      handler: (response: CheckoutSuccess) => resolve({ status: "paid", response }),
      modal: {
        // Called when the driver closes Checkout without paying.
        ondismiss: () => resolve(failure ? { status: "failed", reason: failure } : { status: "dismissed" }),
      },
    });
    checkout.on("payment.failed", (response) => {
      // Checkout stays open so the driver can try again; remember why it failed.
      failure = response.error?.description ?? "The payment failed.";
    });
    checkout.open();
  });
}
