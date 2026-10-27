// Central access policy for the API surface.
//
// One table decides the minimum required access for every API path, so a new
// route cannot accidentally become reachable by an examiner. Route-level guards
// (requireAdmin / requireStaff) still apply on top — this is the coarse
// server-side gate, not the whole story.
//
// "public"        — no identity needed. Reserved for the health probe, the auth
//                   endpoints themselves, and the legacy /api/admin surface
//                   (which enforces its own 401/403/503 semantics).
// "authenticated" — any signed-in user (admin or examiner).
// "admin"         — administrators only.
//
// IMPORTANT: `/ihk` (list + search + detail) stays readable for every signed-in
// user, because the start page `/` and the IHK detail pages `/ihk/:id` are part
// of the examiner's allowed area (reached by clicking a card). Everything an
// examiner must NOT see — the user management, the question pool, the case
// examples, the raw sheet/import surfaces — is admin-only here, so the
// restriction holds even when the UI is bypassed.

export type Access = "public" | "authenticated" | "admin";

const ADMIN_ONLY_PREFIXES = ["/questions", "/case-examples", "/sheets", "/import", "/users"];

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

  // IHK list, search AND detail: readable by any signed-in user (start page and
  // the detail pages behind the cards). Still not public, so an anonymous
  // visitor cannot scrape the data.
  if (clean === "/ihk" || clean.startsWith("/ihk/")) return "authenticated";

  for (const p of ADMIN_ONLY_PREFIXES) {
    if (clean === p || clean.startsWith(`${p}/`)) return "admin";
  }
  if (clean === "/oral" || clean.startsWith("/oral/")) {
    // The oral exam simulation is the examiner's working area: reading the
    // themes/pool/exams AND running an exam (create, rate, complete, delete) is
    // allowed for both roles. Only seeding the question pool stays admin-only,
    // since that mutates the shared pool rather than an exam.
    if (clean === "/oral/seed" || clean.startsWith("/oral/seed/")) return "admin";
    return "authenticated";
  }
  return "public";
}
