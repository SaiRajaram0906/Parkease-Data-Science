import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { currentUser, requireAuth } from "../lib/auth";
import { mailSettings, sendMail } from "../lib/mailer";

/**
 * GET  /notifications[?bookingId=]   the signed-in user's booking messages
 * GET  /notifications/email-status   is sending email set up on this server?
 * POST /notifications/test           send a test email to your own address
 */
const router: IRouter = Router();
router.use("/notifications", requireAuth);

router.get("/notifications/email-status", (_req, res): void => {
  const settings = mailSettings();
  res.json({ configured: settings.configured, from: settings.configured ? settings.from : null });
});

router.post("/notifications/test", async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const subject = "ParkEase test email";
  const body = "This is a test message from ParkEase. Booking start and end messages will arrive at this address.";
  const result = await sendMail({ to: user.email, subject, text: `Hi ${user.name},\n\n${body}` });
  const [saved] = await db
    .insert(notificationsTable)
    .values({
      userId: user.id,
      kind: "test",
      toEmail: user.email,
      subject,
      body,
      emailStatus: result.status,
      emailError: result.error ?? null,
    })
    .returning();
  res.json(saved);
});

router.get("/notifications", async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  const bookingId = Number(req.query["bookingId"]);
  const conditions = [eq(notificationsTable.userId, user.id)];
  if (Number.isInteger(bookingId) && bookingId > 0) conditions.push(eq(notificationsTable.bookingId, bookingId));
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  res.json(rows);
});

export default router;
