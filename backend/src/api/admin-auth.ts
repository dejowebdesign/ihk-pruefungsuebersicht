// Admin authentication middleware.
//
// Uses a single shared secret (ADMIN_TOKEN env var). Constant-time comparison
// guards against timing attacks. The design is intentionally minimal so it can
// be swapped for JWT/sessions later without touching route handlers — routes
// only depend on `adminAuth`, not on the token mechanism.
//
// The token is NEVER hardcoded. If ADMIN_TOKEN is unset, all admin endpoints
// return 503 (configured) rather than 401, so misconfiguration fails closed.

import type { Context, MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";

/** True when an ADMIN_TOKEN has been configured. */
export function adminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length > 0);
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

function tokenFromRequest(c: Context): string | null {
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

export const adminAuth: MiddlewareHandler = async (c, next) => {
  if (!adminAuthConfigured()) {
    return c.json({ error: "admin endpoints disabled (ADMIN_TOKEN not configured)" }, 503);
  }
  const presented = tokenFromRequest(c);
  if (!presented) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // Hash both sides before comparing to normalize length and avoid raw comparison.
  const presentedHash = createHash("sha256").update(presented).digest("hex");
  const expectedHash = createHash("sha256").update(process.env.ADMIN_TOKEN!).digest("hex");
  if (!constantTimeEqual(presentedHash, expectedHash)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
