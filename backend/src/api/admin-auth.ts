// Admin authentication middleware — the SINGLE gate for every admin/write
// endpoint (admin routes, oral writes). Two credentials are accepted:
//
//   1. Legacy shared secret  — `Authorization: Bearer <ADMIN_TOKEN>`
//      (kept for backwards compatibility with existing scripts/clients).
//   2. Browser session       — an opaque session id in the HttpOnly cookie
//      `ihk_admin_session`, issued by POST /api/auth/login. Validated
//      server-side against the in-memory session store.
//
// There is deliberately only ONE auth mechanism (this middleware): the session
// path was added alongside the token path, not as a second, competing system.
// Routes only depend on `adminAuth`, never on the credential type.
//
// Security properties:
//   - Constant-time comparison of the legacy token.
//   - Cookie-authenticated state-changing requests are CSRF-checked (Origin).
//   - Fails closed: when nothing is configured, admin endpoints return 503.

import type { Context, MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { adminPasswordConfigured } from "./admin-credentials";
import { getSession } from "./session";
import { csrfCheck } from "./csrf";

export const ADMIN_SESSION_COOKIE = "ihk_admin_session";

/** True when a legacy ADMIN_TOKEN has been configured. */
export function adminTokenConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length > 0);
}

/** True when ANY admin credential is configured (token or username/password). */
export function adminAuthConfigured(): boolean {
  return adminTokenConfigured() || adminPasswordConfigured();
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against a same-length dummy to keep timing constant.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (header) {
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    return header.trim();
  }
  // Allow ?token= for dev convenience only (not recommended for production).
  const q = c.req.query("token");
  if (q) return q.trim();
  return null;
}

/** Read a cookie value from the request (no cookie-parser dependency). */
export function cookieValue(c: Context, name: string): string | null {
  const header = c.req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Verify the legacy bearer token against ADMIN_TOKEN (constant time). */
function validToken(presented: string): boolean {
  if (!adminTokenConfigured()) return false;
  const presentedHash = createHash("sha256").update(presented).digest("hex");
  const expectedHash = createHash("sha256").update(process.env.ADMIN_TOKEN!).digest("hex");
  return constantTimeEqual(presentedHash, expectedHash);
}

export const adminAuth: MiddlewareHandler = async (c, next) => {
  if (!adminAuthConfigured()) {
    return c.json({ error: "admin endpoints disabled (no admin credentials configured)" }, 503);
  }

  // 1) Legacy bearer token — exempt from CSRF (never sent automatically by browsers).
  const presented = bearerToken(c);
  if (presented && validToken(presented)) {
    await next();
    return;
  }

  // 2) Session cookie — state-changing requests must pass the CSRF check.
  const session = getSession(cookieValue(c, ADMIN_SESSION_COOKIE));
  if (session) {
    if (!csrfCheck(c)) {
      return c.json({ error: "csrf check failed" }, 403);
    }
    await next();
    return;
  }

  return c.json({ error: "unauthorized" }, 401);
};
