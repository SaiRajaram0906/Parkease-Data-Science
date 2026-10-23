import { Router, type IRouter } from "express";
import { currentUser, requireAuth } from "../lib/auth";
import { rewardSummary } from "../lib/rewards";

/**
 * GET /rewards   the signed-in driver's reward progress
 * (one free booking for every ten paid bookings; see lib/rewards).
 */
const router: IRouter = Router();

router.get("/rewards", requireAuth, async (_req, res): Promise<void> => {
  res.json(await rewardSummary(currentUser(res)!.id));
});

export default router;
