// User + session service. All authorization decisions in the app resolve to
// either a `User` row (database-backed session cookie) or the legacy shared
// ADMIN_TOKEN, which always maps to the "admin" role (see api/identity.ts).
//
// Two invariants are enforced here rather than in the route handlers, so they
// hold no matter which route calls in:
//   1. A deactivated user can never authenticate, and an existing session of a
//      deactivated user stops resolving immediately (active is re-checked on
//      every request).
//   2. The last active administrator cannot be deactivated, deleted or demoted
//      — that would lock everybody out of user management.

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./passwords";

export type Role = "admin" | "participant";
export const ROLES: readonly Role[] = ["admin", "participant"] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const SESSION_COOKIE = "ihk_session";
const SESSION_TTL_DAYS = 7;

/** Public shape of a user — NEVER contains passwordHash. */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
} as const;

function toPublic(u: {
  id: string;
  username: string;
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}): PublicUser {
  return { ...u, role: u.role === "admin" ? "admin" : "participant" };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Validate + normalize a username. Throws on anything unusable. */
export function normalizeUsername(input: unknown): string {
  if (typeof input !== "string") throw new Error("username is required");
  const username = input.trim().toLowerCase();
  if (username.length < 3) throw new Error("username must be at least 3 characters");
  if (username.length > 64) throw new Error("username must be at most 64 characters");
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("username may only contain letters, digits, '.', '_' and '-'");
  }
  return username;
}

export async function listUsers(db: PrismaClient): Promise<PublicUser[]> {
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { username: "asc" }],
    select: PUBLIC_FIELDS,
  });
  return users.map(toPublic);
}

export async function getUser(db: PrismaClient, id: string): Promise<PublicUser | null> {
  const u = await db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  return u ? toPublic(u) : null;
}

export async function createUser(
  db: PrismaClient,
  input: { username: string; password: string; role: Role },
): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  if (!isRole(input.role)) throw new Error("invalid role");
  if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) throw new Error("username already exists");

  const created = await db.user.create({
    data: {
      username,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      active: true,
    },
    select: PUBLIC_FIELDS,
  });
  return toPublic(created);
}

/** Count active administrators — the invariant guard for admin management. */
export async function activeAdminCount(db: PrismaClient): Promise<number> {
  return db.user.count({ where: { role: "admin", active: true } });
}

/**
 * True when removing/deactivating `userId` would leave zero active admins.
 * Only applies to users that currently ARE an active admin.
 */
async function isLastActiveAdmin(db: PrismaClient, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "admin" || !user.active) return false;
  return (await activeAdminCount(db)) <= 1;
}

/** Set (reset) a user's password. Revokes that user's sessions by default. */
export async function setPassword(
  db: PrismaClient,
  userId: string,
  password: string,
  opts: { keepSessions?: boolean } = {},
): Promise<void> {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user not found");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    if (!opts.keepSessions) {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  });
}

/**
 * Activate/deactivate a user. Deactivating immediately kills access: the flag
 * is re-checked on every request AND all live sessions are revoked at once.
 * Guarded so the last active admin can never be deactivated.
 */
export async function setActive(
  db: PrismaClient,
  userId: string,
  active: boolean,
): Promise<PublicUser> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user not found");
  if (!active && (await isLastActiveAdmin(db, userId))) {
    throw new Error("the last active administrator cannot be deactivated");
  }
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: userId },
      data: { active, disabledAt: active ? null : new Date() },
      select: PUBLIC_FIELDS,
    });
    if (!active) {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return u;
  });
  return toPublic(updated);
}

/** Change a user's role. Guarded so the last active admin cannot be demoted. */
export async function setRole(db: PrismaClient, userId: string, role: Role): Promise<PublicUser> {
  if (!isRole(role)) throw new Error("invalid role");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user not found");
  if (role !== "admin" && (await isLastActiveAdmin(db, userId))) {
    throw new Error("the last active administrator cannot be demoted");
  }
  const updated = await db.user.update({
    where: { id: userId },
    data: { role },
    select: PUBLIC_FIELDS,
  });
  return toPublic(updated);
}

/**
 * Soft-delete a user (deactivate). Kept as a separate operation so the
 * "delete" UI path never issues a hard DELETE that would cascade into exams.
 */
export async function removeUser(db: PrismaClient, userId: string): Promise<PublicUser> {
  return setActive(db, userId, false);
}

// ── sessions ───────────────────────────────────────────────────────────────

/** Create a session and return the RAW token (stored only as a hash). */
export async function createSession(
  db: PrismaClient,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/**
 * Resolve a raw session token to its active user. Returns null when the token
 * is unknown, revoked, expired, or belongs to a deactivated account.
 */
export async function resolveSession(
  db: PrismaClient,
  rawToken: string,
): Promise<PublicUser | null> {
  if (!rawToken) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: PUBLIC_FIELDS } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.active) return null;
  return toPublic(session.user);
}

/** Revoke one session by its raw token (logout). Idempotent. */
export async function revokeSession(db: PrismaClient, rawToken: string): Promise<void> {
  if (!rawToken) return;
  await db.session.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every live session of a user (used on deactivation / password reset). */
export async function revokeUserSessions(db: PrismaClient, userId: string): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Authenticate username + password. Deactivated accounts always fail. */
export async function authenticate(
  db: PrismaClient,
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<PublicUser | null> {
  if (typeof passwordInput !== "string" || passwordInput.length === 0) return null;
  let username: string;
  try {
    username = normalizeUsername(usernameInput);
  } catch {
    return null;
  }
  const user = await db.user.findUnique({ where: { username } });
  if (!user) return null;
  const ok = await verifyPassword(passwordInput, user.passwordHash);
  if (!ok) return null;
  if (!user.active) return null;
  return toPublic(user);
}

/**
 * Bootstrap: guarantee a usable admin exists so the app is never locked out.
 *
 * - No admin yet + ADMIN_PASSWORD set  → create "admin" with that password.
 * - No admin yet + only ADMIN_TOKEN    → create "admin" whose password IS the
 *   token value. This keeps every existing deployment working: the operator
 *   already knows the token and can log in with it, then set a real password.
 * - An admin already exists             → no-op (never touches credentials).
 */
export async function bootstrapAdmin(db: PrismaClient): Promise<{ created: boolean; username?: string }> {
  const admins = await db.user.count({ where: { role: "admin" } });
  if (admins > 0) return { created: false };

  const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || "";
  if (password.length < MIN_PASSWORD_LENGTH) return { created: false };

  try {
    const user = await createUser(db, { username: "admin", password, role: "admin" });
    return { created: true, username: user.username };
  } catch (e) {
    // Username may already exist as a non-admin row; adopt it as admin instead
    // of failing, so the deployment still has a way in.
    const msg = e instanceof Error ? e.message : "";
    if (msg === "username already exists") {
      const existing = await db.user.findUnique({ where: { username: "admin" } });
      if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: { role: "admin", active: true, disabledAt: null },
        });
        return { created: false, username: "admin" };
      }
    }
    return { created: false };
  }
}
