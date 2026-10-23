import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spotsRouter from "./spots";
import bookingsRouter from "./bookings";
import usersRouter from "./users";
import reviewsRouter from "./reviews";
import dashboardRouter from "./dashboard";
import dataScienceRouter from "./datascience";
import authRouter from "./auth";
import adminRouter from "./admin";
import assistantRouter from "./assistant";
import rewardsRouter from "./rewards";
import notificationsRouter from "./notifications";
import { attachUser } from "../lib/auth";

const router: IRouter = Router();

// Identify the caller (if a token was sent) before any route runs.
router.use(attachUser);

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(assistantRouter);
router.use(rewardsRouter);
router.use(notificationsRouter);
router.use(spotsRouter);
router.use(bookingsRouter);
router.use(usersRouter);
router.use(reviewsRouter);
router.use(dashboardRouter);
router.use(dataScienceRouter);

export default router;
