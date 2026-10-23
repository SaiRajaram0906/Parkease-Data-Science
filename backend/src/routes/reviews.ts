import { Router, type IRouter } from "express";
import { eq, avg, count } from "drizzle-orm";
import { db, reviewsTable, spotsTable } from "@workspace/db";
import { CreateReviewBody } from "@workspace/api-zod";
import { currentUser, requireRole } from "../lib/auth";

const router: IRouter = Router();

// Reviews are written by drivers (the people who park).
router.post("/reviews", requireRole("driver", "admin"), async (req, res): Promise<void> => {
  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [review] = await db
    .insert(reviewsTable)
    // A review is always recorded under the signed-in user.
    .values({ ...parsed.data, userId: currentUser(res)!.id, userName: currentUser(res)!.name })
    .returning();

  const [stats] = await db
    .select({
      avgRating: avg(reviewsTable.rating),
      totalReviews: count(reviewsTable.id),
    })
    .from(reviewsTable)
    .where(eq(reviewsTable.spotId, parsed.data.spotId));

  if (stats) {
    await db
      .update(spotsTable)
      .set({
        rating: stats.avgRating ?? null,
        totalReviews: Number(stats.totalReviews),
      })
      .where(eq(spotsTable.id, parsed.data.spotId));
  }

  res.status(201).json(review);
});

export default router;
