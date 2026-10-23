import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  GetUserParams,
  UpdateUserParams,
  UpdateUserBody,
} from "@workspace/api-zod";
import { allowSelfOrAdmin, publicUser, requireAuth, requireRole } from "../lib/auth";

/**
 * User records. Signing up and signing in are in routes/auth.ts.
 *
 *   GET   /users       admin only
 *   POST  /users       admin only (creates an account without a password)
 *   GET   /users/:id   the user themselves, or an admin
 *   PATCH /users/:id   the user themselves, or an admin (name, phone, avatar)
 *
 * The password hash is never returned.
 */
const router: IRouter = Router();

router.get("/users", requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  res.json(users.map(publicUser));
});

router.post("/users", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email));

  if (existing[0]) {
    res.status(201).json(publicUser(existing[0]));
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(publicUser(user!));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!allowSelfOrAdmin(res, params.data.id)) return;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(publicUser(user));
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!allowSelfOrAdmin(res, params.data.id)) return;

  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(publicUser(user));
});

export default router;
