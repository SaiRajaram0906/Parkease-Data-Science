import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { currentUser, requireAuth, requireRole } from "../lib/auth";
import { prepareBooking } from "../lib/bookingRules";
import { createOrder, paymentSettings, PaymentError, signatureIsValid, toPaise } from "../lib/payments";

/**
 * Payments.
 *
 *   GET  /payments/config     "razorpay" or "simulated", the public key id, commission
 *   POST /payments/checkout   hold the slot and create a Razorpay order for it
 *   POST /payments/verify     check Razorpay's signature and confirm the booking
 *   POST /payments/abandon    the driver closed or failed the payment: release the slot
 *
 * A booking waiting for payment has status "pending". It holds its slot for
 * up to 15 minutes; after that the background task releases it.
 */
const router: IRouter = Router();

router.get("/payments/config", (_req, res): void => {
  const s = paymentSettings();
  res.json({
    mode: s.mode,
    keyId: s.mode === "razorpay" ? s.keyId : null,
    currency: "INR",
    commissionPercent: s.commissionPercent,
    refundPolicy: "Full refund if you cancel before your parking time starts. No refund after it starts.",
  });
});

router.post("/payments/checkout", requireRole("driver", "admin"), async (req, res): Promise<void> => {
  const settings = paymentSettings();
  if (settings.mode !== "razorpay") {
    res.status(400).json({ error: "Online payments are not set up on this server (demo mode)." });
    return;
  }
  const user = currentUser(res)!;
  const prepared = await prepareBooking(req.body, user);
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  if (prepared.useReward || prepared.amount <= 0) {
    res.status(400).json({ error: "This booking is free; it does not need a payment." });
    return;
  }

  // Hold the slot first, so nobody else can take it while the driver pays.
  const [booking] = await db
    .insert(bookingsTable)
    .values({ ...prepared.values, status: "pending", paymentStatus: "pending", paymentMode: "razorpay" })
    .returning();

  try {
    const order = await createOrder(toPaise(prepared.amount), `booking_${booking!.id}`, {
      booking_id: String(booking!.id),
      spot: prepared.spot.name.slice(0, 200),
    });
    await db.update(bookingsTable).set({ paymentOrderId: order.id }).where(eq(bookingsTable.id, booking!.id));
    res.status(201).json({
      bookingId: booking!.id,
      keyId: settings.keyId,
      orderId: order.id,
      amount: order.amount, // paise
      currency: order.currency,
      name: "ParkEase",
      description: `${prepared.spot.name} · ${prepared.values.durationHours} h`,
      prefill: { name: user.name, email: user.email, contact: user.phone ?? "" },
    });
  } catch (err) {
    // No order means no payment can happen: release the slot again.
    await db
      .update(bookingsTable)
      .set({ status: "cancelled", paymentStatus: "failed", refundError: "Payment could not be started." })
      .where(eq(bookingsTable.id, booking!.id));
    res.status(err instanceof PaymentError ? err.status : 502).json({
      error: err instanceof PaymentError ? err.message : "The payment could not be started.",
    });
  }
});

router.post("/payments/verify", requireAuth, async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const bookingId = Number(req.body?.bookingId);
  const paymentId = String(req.body?.razorpay_payment_id ?? "");
  const signature = String(req.body?.razorpay_signature ?? "");
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.userId, user.id)));
  if (!booking || booking.paymentMode !== "razorpay" || !booking.paymentOrderId) {
    res.status(404).json({ error: "Payment not found for this booking." });
    return;
  }
  if (booking.paymentStatus === "paid" && booking.paymentId === paymentId) {
    res.json(booking); // already confirmed (for example a repeated request)
    return;
  }
  // The order id is taken from our own records, never from the browser.
  if (!signatureIsValid(booking.paymentOrderId, paymentId, signature)) {
    res.status(400).json({ error: "The payment could not be verified. If money was taken, it will be refunded by Razorpay." });
    return;
  }
  if (booking.status === "cancelled") {
    res.status(409).json({ error: "This booking expired before the payment finished. Contact support for a refund.", paymentId });
    return;
  }
  const [updated] = await db
    .update(bookingsTable)
    .set({ status: "confirmed", paymentStatus: "paid", paymentId, notes: "Paid with Razorpay" })
    .where(eq(bookingsTable.id, booking.id))
    .returning();
  res.json(updated);
});

router.post("/payments/abandon", requireAuth, async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const bookingId = Number(req.body?.bookingId);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : "Payment was not completed.";
  const [updated] = await db
    .update(bookingsTable)
    .set({ status: "cancelled", paymentStatus: "failed", refundError: reason })
    .where(
      and(
        eq(bookingsTable.id, bookingId),
        eq(bookingsTable.userId, user.id),
        eq(bookingsTable.status, "pending"),
        eq(bookingsTable.paymentStatus, "pending"),
      ),
    )
    .returning();
  res.json({ released: Boolean(updated) });
});

export default router;
