import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, bookingsTable, payoutsTable, spotsTable, usersTable } from "@workspace/db";
import { currentUser, isAdmin, requireAuth, requireRole } from "../lib/auth";
import { paymentSettings } from "../lib/payments";

/**
 * Owner earnings and payouts.
 *
 * An owner earns the price of every completed, paid booking on their spots,
 * minus the platform commission. An admin sends the money (by UPI or bank
 * transfer, or later through Razorpay Route) and records each payout here,
 * so both sides can see what is owed.
 *
 *   GET   /payouts/summary[?ownerId=]   earnings, payouts and balance
 *   GET   /payouts/owners               admin: every owner's balance
 *   POST  /payouts                      admin: record a payout
 *   PATCH /payouts/details              owner: set UPI ID and account name
 */
const router: IRouter = Router();
const round = (n: number) => Math.round(n * 100) / 100;

async function summaryFor(ownerId: number) {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, ownerId));
  const spots = await db.select({ id: spotsTable.id }).from(spotsTable).where(eq(spotsTable.ownerId, ownerId));
  const spotIds = spots.map((s) => s.id);
  const earning = spotIds.length
    ? await db
        .select()
        .from(bookingsTable)
        .where(
          and(
            inArray(bookingsTable.spotId, spotIds),
            eq(bookingsTable.status, "completed"),
            eq(bookingsTable.paymentStatus, "paid"),
            eq(bookingsTable.isReward, false),
          ),
        )
    : [];
  const payouts = await db
    .select()
    .from(payoutsTable)
    .where(eq(payoutsTable.ownerId, ownerId))
    .orderBy(desc(payoutsTable.createdAt));

  const { commissionPercent } = paymentSettings();
  const gross = round(earning.reduce((sum, b) => sum + Number(b.totalAmount), 0));
  const commission = round((gross * commissionPercent) / 100);
  const net = round(gross - commission);
  const paidOut = round(payouts.reduce((sum, p) => sum + Number(p.amount), 0));
  return {
    ownerId,
    ownerName: owner?.name ?? "Unknown",
    ownerEmail: owner?.email ?? null,
    payoutUpi: owner?.payoutUpi ?? null,
    payoutName: owner?.payoutName ?? null,
    completedPaidBookings: earning.length,
    gross,
    commissionPercent,
    commission,
    net,
    paidOut,
    balance: round(net - paidOut),
    payouts,
  };
}

router.get("/payouts/summary", requireAuth, async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const requested = Number(req.query["ownerId"]);
  const ownerId = isAdmin(user) && Number.isInteger(requested) && requested > 0 ? requested : user.id;
  if (!isAdmin(user) && user.role !== "owner") {
    res.status(403).json({ error: "Only parking owners have earnings." });
    return;
  }
  res.json(await summaryFor(ownerId));
});

router.get("/payouts/owners", requireRole("admin"), async (_req, res): Promise<void> => {
  const owners = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "owner"));
  const rows = [];
  for (const owner of owners) rows.push(await summaryFor(owner.id));
  rows.sort((a, b) => b.balance - a.balance);
  res.json(rows.map(({ payouts, ...rest }) => ({ ...rest, payoutCount: payouts.length })));
});

router.post("/payouts", requireRole("admin"), async (req, res): Promise<void> => {
  const ownerId = Number(req.body?.ownerId);
  const amount = round(Number(req.body?.amount));
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
  if (!Number.isInteger(ownerId) || !(amount > 0) || !reference) {
    res.status(400).json({ error: "Owner, a positive amount and the transfer reference are required." });
    return;
  }
  const summary = await summaryFor(ownerId);
  if (amount > summary.balance) {
    res.status(400).json({ error: `The amount is more than this owner's balance (₹${summary.balance.toFixed(2)}).` });
    return;
  }
  const [payout] = await db
    .insert(payoutsTable)
    .values({
      ownerId,
      amount: amount.toFixed(2),
      reference: reference.slice(0, 120),
      note: typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : null,
      createdBy: currentUser(res)!.id,
    })
    .returning();
  res.status(201).json(payout);
});

router.patch("/payouts/details", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const upi = typeof req.body?.payoutUpi === "string" ? req.body.payoutUpi.trim() : "";
  const name = typeof req.body?.payoutName === "string" ? req.body.payoutName.trim() : "";
  // A UPI ID looks like name@bank.
  if (upi && !/^[\w.\-]{2,256}@[a-zA-Z][\w.\-]{1,64}$/.test(upi)) {
    res.status(400).json({ error: "Enter a valid UPI ID, for example yourname@okhdfcbank." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ payoutUpi: upi || null, payoutName: name.slice(0, 120) || null })
    .where(eq(usersTable.id, currentUser(res)!.id))
    .returning();
  res.json({ payoutUpi: updated!.payoutUpi, payoutName: updated!.payoutName });
});

export default router;
