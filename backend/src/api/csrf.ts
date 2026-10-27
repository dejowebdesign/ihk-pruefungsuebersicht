// CSRF protection for cookie-authenticated state-changing requests.
//
// The admin session travels in a cookie (SameSite=Lax), which already blocks
// cross-site POSTs in modern browsers. As defence in depth we additionally
// require, for every state-changing request authenticated via cookie, that the
// Origin (or Referer) header matches an allowed origin. Requests authenticated
// with the legacy Bearer token are exempt — a bearer token is never sent
// automatically by the browser, so it is not CSRF-able.
//
// Allowed origins:
//   - APP_ORIGIN (comma-separated list), when configured, plus
//   - the request's own Host (same-origin), so local/Docker setups work
//     without extra configuration.

import type { Context } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(c: Context): string[] {
  const list: string[] = [];
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    for (const o of configured.split(",")) {
      const t = o.trim();
      if (t) list.push(t.replace(/\/$/, ""));
    }
  }
  // Same-origin candidates. When behind a proxy (Next.js middleware), the real
  // host arrives via X-Forwarded-Host; fall back to Host, then to the request
  // URL's own origin (which covers Hono's app.request in tests).
  const host = c.req.header("x-forwarded-host") || c.req.header("host");
  if (host) {
    const proto = c.req.header("x-forwarded-proto");
    if (proto) {
      list.push(`${proto}://${host}`);
    }
    list.push(`http://${host}`, `https://${host}`);
  }
  try {
    list.push(new URL(c.req.url).origin);
  } catch {
    // ignore malformed URLs
  }
  return list;
}

/** True when the request carries no Origin/Referer (e.g. curl, tests). */
function originHeader(c: Context): string | null {
  const origin = c.req.header("origin");
  if (origin) return origin.replace(/\/$/, "");
  const referer = c.req.header("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Verify CSRF safety for a cookie-authenticated state-changing request.
 * Returns true when the request may proceed.
 *
 * Policy: safe methods always pass. For unsafe methods a matching Origin or
 * Referer is required; if neither header is present the request is rejected,
 * because a browser always sends Origin on cross-site and same-site
 * non-simple requests — its absence indicates a non-browser client, which
 * should use the Bearer token instead.
 */
export function csrfCheck(c: Context): boolean {
  const method = c.req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  const presented = originHeader(c);
  if (!presented) return false;
  const allowed = allowedOrigins(c);
  return allowed.some((o) => o === presented);
}
