// Server-side session store for the admin login.
//
// Sessions live in process memory (single-instance deployment, mirroring the
// scheduler's in-process mutex). A session is an opaque 256-bit random token
// held only in an HttpOnly cookie; the store maps it to a username + expiry.
//
// Design notes:
//   - Tokens are generated with crypto.randomBytes (never derived from user
//     input), so they are not guessable.
//   - Expired sessions are rejected on read and swept lazily, so a long-lived
//     process does not accumulate stale entries.
//   - Logout destroys the session server-side; the cookie is also cleared, but
//     the server-side invalidation is what actually revokes access.
//   - Sessions are NOT persisted: a restart (or a second instance) invalidates
//     them, which fails closed — the user simply logs in again.

import { randomBytes } from "node:crypto";

export interface Session {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_HOURS = 8;

/** Session lifetime in milliseconds (ADMIN_SESSION_TTL_HOURS, default 8 h). */
export function sessionTtlMs(): number {
  const raw = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? "");
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

const sessions = new Map<string, Session>();

/** Create a new session for `username` and return its token. */
export function createSession(username: string, ttlMs: number = sessionTtlMs()): Session {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: Session = {
    token,
    username,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  sessions.set(token, session);
  return session;
}

/** Look up a session, returning null when unknown or expired (sweeps it). */
export function getSession(token: string | null | undefined): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/** Invalidate a single session (logout). */
export function destroySession(token: string | null | undefined): boolean {
  if (!token) return false;
  return sessions.delete(token);
}

/** Invalidate every session (used by tests / global logout). */
export function destroyAllSessions(): void {
  sessions.clear();
}

/** Drop expired sessions; returns the number removed. */
export function sweepExpiredSessions(now: number = Date.now()): number {
  let removed = 0;
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) {
      sessions.delete(token);
      removed++;
    }
  }
  return removed;
}

/** Number of live (non-expired) sessions — diagnostics/tests only. */
export function activeSessionCount(): number {
  sweepExpiredSessions();
  return sessions.size;
}
