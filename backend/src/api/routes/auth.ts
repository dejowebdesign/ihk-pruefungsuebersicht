// Authentication routes — mounted under /api/auth.
//
//   POST /api/auth/login   verify credentials, open a session, set the cookie
//   POST /api/auth/logout  invalidate the session server-side, clear the cookie
//   GET  /api/auth/me      report the current authentication state
//
// Credentials are verified SERVER-SIDE only (never in the frontend). The
// session id lives in an HttpOnly cookie, so scripts cannot read it. Error
// messages are intentionally generic and never reveal which field was wrong.

import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { ADMIN_SESSION_COOKIE, cookieValue } from "../admin-auth";
import {
  credentialsLoginConfigured,
  verifyCredentials,
} from "../admin-credentials";
import {
  createSession,
  destroySession,
  getSession,
  sessionTtlMs,
} from "../session";
import {
  clearFailures,
  isRateLimited,
  recordFailure,
} from "../rate-limit";
import { csrfCheck } from "../csrf";
import { apiError } from "../helpers";

export const auth = new Hono();

/** Cookie `Secure` flag: on in production or when explicitly forced. */
function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ADMIN_COOKIE_SECURE === "1";
}

/** Rate-limit key: client IP + attempted username (best effort). */
function rateKey(c: Context, username: string): string {
  const fwd = c.req.header("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : c.req.header("x-real-ip"))?.trim() || "unknown";
  return `${ip}:${username.toLowerCase()}`;
}

// ---- login ----

auth.post("/login", async (c) => {
  if (!credentialsLoginConfigured()) {
    return apiError(c, 503, "login disabled (no admin credentials configured)");
  }

  // CSRF: a browser sends Origin on cross-site POSTs. Reject mismatches.
  if (!csrfCheck(c)) {
    return apiError(c, 403, "csrf check failed");
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return apiError(c, 400, "username and password are required");
  }

  const key = rateKey(c, username);
  if (isRateLimited(key)) {
    return apiError(c, 429, "too many failed attempts — please try again later");
  }

  if (!verifyCredentials(username, password)) {
    recordFailure(key);
    // Generic message: never disclose whether the username or password was wrong.
    return apiError(c, 401, "invalid credentials");
  }

  clearFailures(key);
  const session = createSession(username);
  setCookie(c, ADMIN_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(sessionTtlMs() / 1000),
  });
  return c.json({ ok: true, username: session.username });
});

// ---- logout ----

auth.post("/logout", async (c) => {
  // CSRF-protect the logout too when it carries a session cookie.
  const token = cookieValue(c, ADMIN_SESSION_COOKIE);
  if (token && !csrfCheck(c)) {
    return apiError(c, 403, "csrf check failed");
  }
  destroySession(token);
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---- current state ----

auth.get("/me", async (c) => {
  const session = getSession(getCookie(c, ADMIN_SESSION_COOKIE));
  if (!session) return c.json({ authenticated: false, username: null });
  return c.json({ authenticated: true, username: session.username });
});
