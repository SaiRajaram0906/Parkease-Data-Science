import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

/**
 * Authentication and authorisation for the ParkEase API.
 *
 * - Passwords are stored as salted scrypt hashes, never in plain text.
 * - After login the client receives a signed token and sends it back in the
 *   `Authorization: Bearer <token>` header.
 * - `attachUser` reads the token on every request; the `require...` helpers
 *   decide what the caller may do.
 *
 * Roles:
 *   driver  finds parking, books, manages own bookings and profile
 *   owner   everything a driver can do, plus manages own listings and sees
 *           their analytics, demand forecast and price suggestions
 *   admin   everything, on every user and listing, plus the admin console
 */
export type Role = "driver" | "owner" | "admin";
export const ROLES: Role[] = ["driver", "owner", "admin"];

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// Set AUTH_SECRET in backend/.env for a real deployment. Without it a stable
// development secret is derived so tokens survive a server restart.
const SECRET =
  process.env["AUTH_SECRET"] ??
  createHash("sha256").update(`parkease-dev:${process.env["DATABASE_URL"] ?? ""}`).digest("hex");

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Same rule the sign-up form shows: 8+ characters with a number and a symbol. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[0-9]/.test(password)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include at least one special symbol.";
  return null;
}

// ---------------------------------------------------------------------------
// Tokens: "<userId>.<expiresAt>.<signature>"
// ---------------------------------------------------------------------------
function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function createToken(userId: number): string {
  const payload = `${userId}.${Date.now() + TOKEN_LIFETIME_MS}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expires, signature] = parts as [string, string, string];
  const expected = sign(`${id}.${expires}`);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  const userId = Number(id);
  return Number.isInteger(userId) ? userId : null;
}

// ---------------------------------------------------------------------------
// What the API returns about a user: never the password hash
// ---------------------------------------------------------------------------
export function publicUser(user: User) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function currentUser(res: Response): User | null {
  return (res.locals["user"] as User | undefined) ?? null;
}

/** Reads the bearer token, if any, and loads the user. Never rejects. */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const userId = token ? readToken(token) : null;
  if (userId) {
    try {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (user) res.locals["user"] = user;
    } catch (err) {
      next(err);
      return;
    }
  }
  next();
}

export function requireAuth(_req: Request, res: Response, next: NextFunction): void {
  if (!currentUser(res)) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const user = currentUser(res);
    if (!user) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    if (!roles.includes(user.role as Role)) {
      res.status(403).json({ error: "Your account does not have permission to do this." });
      return;
    }
    next();
  };
}

export const isAdmin = (user: User | null): boolean => user?.role === "admin";

/** Sends 403 and returns false unless the caller is `ownerId` or an admin. */
export function allowSelfOrAdmin(res: Response, ownerId: number | null | undefined): boolean {
  const user = currentUser(res);
  if (user && (user.role === "admin" || (ownerId != null && user.id === ownerId))) return true;
  res.status(403).json({ error: "You can only do this for your own account or listings." });
  return false;
}
