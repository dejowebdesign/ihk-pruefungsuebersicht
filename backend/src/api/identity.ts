// Request identity + authorization guards.
//
// Identity comes from exactly two server-verified sources, in this order:
//   1. the `ihk_session` cookie → a live, non-revoked, non-expired session of an
//      ACTIVE user (resolved against the database on every request), or
//   2. the legacy shared ADMIN_TOKEN as a Bearer token → always the "admin"
//      role, so existing admin tooling/integrations keep working unchanged.
//
// The role is NEVER read from the request body, query string or any other
// client-supplied value — a caller cannot claim to be an admin.

import type { Context, MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../db/prisma";
import { SESSION_COOKIE, resolveSession, type PublicUser, type Role } from "../auth/service";

export interface Identity {
  /** User id, or null for the legacy ADMIN_TOKEN identity (no DB row). */
  userId: string | null;
  username: string;
  role: Role;
  via: "session" | "token";
}

export type AuthVariables = { identity: Identity | null };

/** True when the legacy shared ADMIN_TOKEN is configured. */
export function adminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length > 0);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function bearerFromRequest(c: Context): string | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (header) {
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    return header.trim();
  }
  // Allow ?token= for dev convenience only (not recommended for production).
  const q = c.req.query("token");
  return q ? q.trim() : null;
}

/** Read a cookie value from the raw Cookie header (no cookie middleware needed). */
export function cookieValue(c: Context, name: string): string | null {
  const header = c.req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/** The raw session token presented by the client, if any. */
export function sessionTokenFromRequest(c: Context): string | null {
  return cookieValue(c, SESSION_COOKIE) ?? c.req.header("x-session-token") ?? null;
}

/**
 * Resolve the caller's identity, or null when unauthenticated.
 * Never throws: an unreachable/failed lookup degrades to "unauthenticated".
 */
export async function resolveIdentity(c: Context): Promise<Identity | null> {
  const raw = sessionTokenFromRequest(c);
  if (raw) {
    try {
      const user: PublicUser | null = await resolveSession(prisma(), raw);
      if (user) {
        return { userId: user.id, username: user.username, role: user.role, via: "session" };
      }
    } catch {
      // fall through to the token check
    }
  }

  if (adminAuthConfigured()) {
    const presented = bearerFromRequest(c);
    if (presented) {
      const presentedHash = createHash("sha256").update(presented).digest("hex");
      const expectedHash = createHash("sha256").update(process.env.ADMIN_TOKEN!).digest("hex");
      if (constantTimeEqual(presentedHash, expectedHash)) {
        return { userId: null, username: "admin", role: "admin", via: "token" };
      }
    }
  }
  return null;
}

/** Middleware: attach the resolved identity (or null) to the context. */
export const attachIdentity: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  c.set("identity", await resolveIdentity(c));
  await next();
};

/** Middleware: require any authenticated identity (401 otherwise). */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const identity = c.get("identity") ?? (await resolveIdentity(c));
  c.set("identity", identity);
  if (!identity) return c.json({ error: "unauthorized" }, 401);
  await next();
};

/** Middleware: require the "admin" role (401 when anonymous, 403 when not admin). */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const identity = c.get("identity") ?? (await resolveIdentity(c));
  c.set("identity", identity);
  if (!identity) return c.json({ error: "unauthorized" }, 401);
  if (identity.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};

/**
 * Middleware for the legacy /api/admin surface.
 *
 * Keeps the historical fails-closed contract — 503 while NEITHER the shared
 * ADMIN_TOKEN nor any admin account is configured, so a misconfigured deploy is
 * obviously "disabled" rather than looking like a wrong password — while also
 * accepting a normal admin session (so the admin UI works after login).
 */
export const adminGuard: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const identity = c.get("identity") ?? (await resolveIdentity(c));
  c.set("identity", identity);
  if (identity) {
    if (identity.role !== "admin") return c.json({ error: "forbidden" }, 403);
    return next();
  }
  if (!adminAuthConfigured()) {
    let hasAdminUser = false;
    try {
      hasAdminUser = (await prisma().user.count({ where: { role: "admin", active: true } })) > 0;
    } catch {
      hasAdminUser = false;
    }
    if (!hasAdminUser) {
      return c.json({ error: "admin endpoints disabled (no admin account configured)" }, 503);
    }
  }
  return c.json({ error: "unauthorized" }, 401);
};

/** True when the caller may read an exam owned by `ownerUserId`. */
export function canReadExam(identity: Identity, ownerUserId: string | null): boolean {
  if (identity.role === "admin") return true;
  return ownerUserId !== null && ownerUserId === identity.userId;
}
