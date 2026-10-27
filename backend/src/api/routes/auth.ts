// Authentication routes — mounted under /api/auth.
//
//   POST /api/auth/login    { username, password } → sets the session cookie
//   POST /api/auth/logout                        → revokes the session
//   GET  /api/auth/me                            → the current identity
//
// The session cookie is httpOnly + SameSite=Lax so it is not reachable from
// JavaScript (an XSS cannot steal it) and not sent on cross-site POSTs.
// Secure is enabled whenever the request arrived over HTTPS.

import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { prisma } from "../../db/prisma";
import { apiError } from "../helpers";
import {
  SESSION_COOKIE,
  authenticate,
  createSession,
  revokeSession,
  type PublicUser,
} from "../../auth/service";
import { sessionTokenFromRequest, type AuthVariables } from "../identity";

export const auth = new Hono<{ Variables: AuthVariables }>();

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // matches SESSION_TTL_DAYS

function isSecureRequest(c: { req: { url: string; header: (n: string) => string | undefined } }): boolean {
  const proto = c.req.header("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function publicJson(user: PublicUser) {
  // Explicit field selection: passwordHash must never leave the backend.
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
  };
}

auth.post("/login", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }

  const user = await authenticate(prisma(), body.username, body.password);
  if (!user) {
    // Deliberately identical response for unknown user, wrong password and
    // deactivated account — no account enumeration.
    return apiError(c, 401, "invalid credentials");
  }

  const { token } = await createSession(prisma(), user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: isSecureRequest(c),
  });
  return c.json({ user: publicJson(user) });
});

auth.post("/logout", async (c) => {
  const raw = sessionTokenFromRequest(c);
  if (raw) await revokeSession(prisma(), raw);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const identity = c.get("identity");
  if (!identity) return apiError(c, 401, "unauthorized");
  return c.json({
    user: {
      id: identity.userId,
      username: identity.username,
      role: identity.role,
      active: true,
    },
  });
});
