import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Two responsibilities, both evaluated per request at the edge/server:
//
//   1. API proxy: forward /api/* to the Hono backend (BACKEND_URL). Middleware
//      rather than next.config rewrites() because rewrites are baked in at build
//      time, while this reads the env var at request time (needed for Docker).
//
//   2. Page authorization: the pages themselves are gated here, server-side.
//      An examiner may only reach the start page `/`, the IHK detail pages
//      `/ihk/:id` (reached by clicking a card) and `/muendliche-pruefung*`;
//      every other page is admin-only. The role comes from /api/auth/me (a
//      server-verified session cookie), never from a client-supplied value.

const EXAMINER_ROUTES = ["/", "/ihk", "/muendliche-pruefung"];
const PUBLIC_ROUTES = ["/login"];

function isWithin(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => {
    if (p === "/") return pathname === "/";
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

/** Next.js internals + static assets must never be gated. */
function isAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

async function resolveRole(
  request: NextRequest,
  backend: string,
): Promise<"admin" | "examiner" | null> {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(`${backend}/api/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { role?: string } };
    const role = body.user?.role;
    // Anything that is not an administrator is treated as an examiner (this
    // also covers a not-yet-migrated "participant" row).
    return role === "admin" ? "admin" : role ? "examiner" : null;
  } catch {
    // Backend unreachable: fail closed for protected pages.
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const backend = process.env.BACKEND_URL || "http://localhost:3001";
  const pathname = request.nextUrl.pathname;

  // ── API proxy ──────────────────────────────────────────────────────────
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const path = pathname.replace(/^\/api/, "");
    const url = `${backend}/api${path}${request.nextUrl.search}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    // The body is re-read below, so the original framing headers no longer
    // describe it. Left in place they make undici reject the request with
    // RequestContentLengthMismatchError (this broke every DELETE).
    headers.delete("content-length");
    headers.delete("transfer-encoding");

    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = await request.text();
      if (body) init.body = body;
    }

    try {
      const res = await fetch(new URL(url), init);
      const respHeaders = new Headers();
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() !== "transfer-encoding") respHeaders.set(k, v);
      });
      const body = res.status === 204 ? null : await res.arrayBuffer();
      return new NextResponse(body, { status: res.status, headers: respHeaders });
    } catch (e) {
      console.error("[proxy] error", request.method, pathname, e);
      return NextResponse.json(
        { error: "Der Backend-Dienst ist momentan nicht erreichbar." },
        { status: 502 },
      );
    }
  }

  if (isAsset(pathname)) return NextResponse.next();

  // ── page authorization ─────────────────────────────────────────────────
  if (isWithin(pathname, PUBLIC_ROUTES)) {
    // Already signed in? Skip the login form.
    const role = await resolveRole(request, backend);
    if (role) {
      return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/", request.url));
    }
    return NextResponse.next();
  }

  const role = await resolveRole(request, backend);
  if (!role) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (role !== "admin" && !isWithin(pathname, EXAMINER_ROUTES)) {
    // Examiners are redirected to the area they are allowed to use rather
    // than shown a dead end.
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next.js build output. Asset/static paths are handled
  // inside the middleware so page rules stay in one readable place.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
