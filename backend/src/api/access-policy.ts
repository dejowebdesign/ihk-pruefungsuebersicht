// Central access policy for the API surface.
//
// One table decides the minimum required access for every API path, so a new
// route cannot accidentally become reachable by a participant. Route-level
// guards (requireAdmin / ownership checks) still apply on top — this is the
// coarse server-side gate, not the whole story.
//
// "public"        — no identity needed. Reserved for the health probe, the auth
//                   endpoints themselves, and the legacy /api/admin surface
//                   (which enforces its own 401/403/503 semantics).
// "authenticated" — any signed-in user (admin or participant).
// "admin"         — administrators only.
//
// IMPORTANT: `/ihk` (list + search) stays public because the start page `/` is
// one of the two areas participants are allowed to use and it renders that
// list. Everything participants must NOT see — the single-IHK detail page, the
// question pool, the case examples, the raw sheet/import surfaces — is
// admin-only here, so the restriction holds even when the UI is bypassed.

export type Access = "public" | "authenticated" | "admin";

const ADMIN_ONLY_PREFIXES = ["/questions", "/case-examples", "/sheets", "/import", "/users"];

/** True when `path` (pathname WITHOUT the leading "/api") is an IHK detail route. */
function isIhkDetail(path: string): boolean {
  if (!path.startsWith("/ihk/")) return false;
  const sub = path.slice("/ihk/".length);
  // /api/ihk/search is a list-style query used by the participant start page.
  return sub !== "search" && !sub.startsWith("search?");
}

/**
 * Minimum access required for a request. Unknown paths resolve to "public" so
 * they fall through to the router and produce a normal 404 instead of a
 * misleading 401/403.
 */
export function requiredAccess(method: string, path: string): Access {
  const rest = path === "/api" ? "" : path.replace(/^\/api/, "");
  const clean = rest.split("?")[0];

  if (clean === "" || clean === "/health") return "public";
  // Auth endpoints answer for themselves (login must be reachable anonymously).
  if (clean === "/auth" || clean.startsWith("/auth/")) return "public";
  // Legacy admin surface keeps its own 503-when-unconfigured failsafe.
  if (clean === "/admin" || clean.startsWith("/admin/")) return "public";

  if (clean === "/ihk" || clean.startsWith("/ihk/")) {
    return isIhkDetail(clean) ? "admin" : "public";
  }
  for (const p of ADMIN_ONLY_PREFIXES) {
    if (clean === p || clean.startsWith(`${p}/`)) return "admin";
  }
  if (clean === "/oral" || clean.startsWith("/oral/")) {
    // Reading themes/pool/exams is part of the participant area; every write
    // operation and the seed endpoint are administrative.
    return method === "GET" || method === "HEAD" ? "authenticated" : "admin";
  }
  return "public";
}
