import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  createToken, currentUser, hashPassword, passwordProblem, publicUser, requireAuth, verifyPassword,
} from "../lib/auth";

/**
 * Sign-up, sign-in and the demo accounts.
 *
 *   POST /auth/register   { name, email, password, role: "driver" | "owner" }
 *   POST /auth/login      { email, password }
 *   POST /auth/demo       { role: "driver" | "owner" | "admin" }
 *   GET  /auth/me         the signed-in user
 *
 * Each successful call returns { user, token }.
 */
const router: IRouter = Router();

const DEMO_ACCOUNTS: Record<string, { name: string; email: string }> = {
  driver: { name: "Priya Sharma", email: "priya.sharma@gmail.com" },
  owner: { name: "Rajesh Kumar", email: "rajesh.kumar@gmail.com" },
  admin: { name: "Vikram Nair", email: "vikram.nair@gmail.com" },
};
const DEMO_EMAILS = new Set(Object.values(DEMO_ACCOUNTS).map((a) => a.email));

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

router.post("/auth/register", async (req, res): Promise<void> => {
  const name = text(req.body?.name);
  const email = text(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = req.body?.role === "owner" ? "owner" : "driver"; // admin cannot be self-assigned

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: "Enter your name and a valid email address." });
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "This email is already registered. Please sign in." });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, role, passwordHash: hashPassword(password) })
    .returning();
  res.status(201).json({ user: publicUser(user!), token: createToken(user!.id) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const email = text(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Enter your email and password." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const wrong = () => res.status(401).json({ error: "Incorrect email or password." });
  if (!user) {
    wrong();
    return;
  }
  // Demo accounts have no password and cannot be taken over by setting one.
  if ((DEMO_EMAILS.has(user.email) || user.email.endsWith("@demo.parkease.in")) && !user.passwordHash) {
    res.status(400).json({ error: "This is a demo account. Use the demo buttons below." });
    return;
  }
  if (!user.passwordHash) {
    // Account created before passwords existed: the first sign-in sets one.
    const problem = passwordProblem(password);
    if (problem) {
      res.status(400).json({ error: `This account has no password yet. Choose one now. ${problem}` });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(usersTable.id, user.id))
      .returning();
    res.json({ user: publicUser(updated!), token: createToken(user.id), passwordSet: true });
    return;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    wrong();
    return;
  }
  res.json({ user: publicUser(user), token: createToken(user.id) });
});

router.post("/auth/demo", async (req, res): Promise<void> => {
  const role = text(req.body?.role);
  const account = DEMO_ACCOUNTS[role];
  if (!account) {
    res.status(400).json({ error: "Unknown demo role." });
    return;
  }
  let [user] = await db.select().from(usersTable).where(eq(usersTable.email, account.email));
  if (!user) {
    [user] = await db.insert(usersTable).values({ ...account, role }).returning();
  }
  res.json({ user: publicUser(user!), token: createToken(user!.id) });
});

router.get("/auth/me", requireAuth, (_req, res): void => {
  res.json({ user: publicUser(currentUser(res)!) });
});

export default router;
