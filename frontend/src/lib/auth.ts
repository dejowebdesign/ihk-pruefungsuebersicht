// Client-side auth helpers.
//
// The session itself lives in an httpOnly cookie that JavaScript cannot read —
// so the browser never handles the credential, and an XSS cannot exfiltrate it.
// What is stored here is only *cached identity* (username + role) so the header
// and route guards can render without a round-trip; every authorization
// decision is still made by the server on each request.
//
// The cache is advisory: if it is stale (e.g. an admin demoted the user), the
// next API call returns 401/403 and the UI drops to the signed-out state.

import type { AuthUser, UserRole } from "./api";

export const IDENTITY_CACHE_KEY = "ihk-identity";

/** Areas an examiner is allowed to use. Everything else is admin-only. */
export const EXAMINER_ROUTES = ["/", "/ihk", "/muendliche-pruefung"];
/** Routes reachable without signing in. */
export const PUBLIC_ROUTES = ["/login"];

// The cache is shared state: the login page writes it, while the header (mounted
// once in the layout) reads it. Without a notification, a client-side login
// would leave the header showing "Anmelden" until a full page reload.
const listeners = new Set<(user: AuthUser | null) => void>();

/** Subscribe to identity changes. Returns an unsubscribe function. */
export function subscribeIdentity(fn: (user: AuthUser | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function readCachedIdentity(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(IDENTITY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed.username !== "string") return null;
    if (parsed.role !== "admin" && parsed.role !== "examiner") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedIdentity(user: AuthUser | null): void {
  if (typeof window !== "undefined") {
    if (!user) localStorage.removeItem(IDENTITY_CACHE_KEY);
    else localStorage.setItem(IDENTITY_CACHE_KEY, JSON.stringify(user));
  }
  for (const fn of listeners) fn(user);
}

export function clearCachedIdentity(): void {
  writeCachedIdentity(null);
}

/** True when `pathname` is inside one of `prefixes` (exact or path-segment match). */
export function isWithin(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => {
    if (p === "/") return pathname === "/";
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

/**
 * Both roles run the oral exam simulation with identical rights: creating,
 * rating, completing, exporting and deleting exams. Only the surrounding admin
 * areas differ. Server-side this is the `requireStaff` guard.
 */
export function canManageExams(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "examiner";
}

/** May a user with `role` open `pathname`? Mirrors the server-side page policy. */
export function canAccessPath(role: UserRole, pathname: string): boolean {
  // Only known roles pass. A retired/unknown role string must not fall through
  // to the examiner branch and inherit access.
  if (role !== "admin" && role !== "examiner") return false;
  if (role === "admin") return true;
  return isWithin(pathname, EXAMINER_ROUTES);
}

export function isPublicPath(pathname: string): boolean {
  return isWithin(pathname, PUBLIC_ROUTES);
}

export function roleLabel(role: UserRole): string {
  return role === "admin" ? "Administrator" : "Prüfer";
}
