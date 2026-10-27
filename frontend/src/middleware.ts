import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Two responsibilities, in order:
//
//   1. Page access control — this instance is fully private, so every page
//      except the login page requires a valid session. Unauthenticated
//      visitors are redirected to /admin/login?next=<original path>.
//   2. Runtime API proxy — forwards /api/* to the Hono backend (BACKEND_URL).
//      We use middleware instead of next.config rewrites() because rewrites are
//      baked into the build, while middleware reads env at request time — so
//      the backend URL stays configurable via the BACKEND_URL env var in Docker.
//
// The backend re-checks every credential itself; this gate only decides which
// *pages* a browser may render. Protected data is never sent to an
// unauthenticated client because the API is gated server-side as well.

const LOGIN_PATH = "/admin/login";

function backendBase(): string {
  return process.env.BACKEND_URL || "http://localhost:3001";
}

/** Strip the /api prefix and forward the request to the backend. */
async function proxyApi(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname.replace(/^\/api/, "");
  const url = `${backendBase()}/api${path}${request.nextUrl.search}`;
  const backendUrl = new URL(url);

  const headers = new Headers(request.headers);
  // The backend must be able to check the browser's real origin for CSRF, but
  // fetch rewrites Host to the backend host. Forward the original host/proto
  // explicitly, then strip host so fetch targets the backend correctly.
  const originalHost = request.headers.get("host");
  if (originalHost) headers.set("x-forwarded-host", originalHost);
  const proto = request.nextUrl.protocol.replace(":", "");
  if (proto) headers.set("x-forwarded-proto", proto);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  try {
    const res = await fetch(backendUrl, init);
    const respHeaders = new Headers();
    res.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      // Drop transfer-encoding; NextResponse sets its own. Drop set-cookie here
      // (handled separately below) because Headers.forEach collapses multiple
      // Set-Cookie values into one comma-joined string, which corrupts cookies.
      if (lower === "transfer-encoding" || lower === "set-cookie") return;
      respHeaders.set(k, v);
    });
    // Forward Set-Cookie verbatim (may be multiple; keep each header separate).
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      respHeaders.append("set-cookie", sc);
    }
    const body = res.status === 204 ? null : await res.arrayBuffer();
    return new NextResponse(body, { status: res.status, headers: respHeaders });
  } catch {
    return NextResponse.json(
      { error: "Der Backend-Dienst ist momentan nicht erreichbar." },
      { status: 502 },
    );
  }
}

/**
 * Ask the backend whether the request carries a valid session. The session
 * cookie is forwarded so the backend can validate it server-side — the
 * middleware itself never trusts a client-supplied claim.
 */
async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get("cookie");
  try {
    const res = await fetch(`${backendBase()}/api/auth/me`, {
      method: "GET",
      headers: {
        ...(cookie ? { cookie } : {}),
        // Same-origin hint so the backend can evaluate CSRF context if needed.
        "x-forwarded-host": request.headers.get("host") ?? "",
        "x-forwarded-proto": request.nextUrl.protocol.replace(":", ""),
      },
      redirect: "manual",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { authenticated?: boolean };
    return data.authenticated === true;
  } catch {
    // Fail closed: if the backend cannot confirm a session, treat the visitor
    // as unauthenticated rather than exposing protected pages.
    return false;
  }
}

/**
 * Build the login redirect. The target is always our own login page; the
 * original path travels in `next` purely so the login page can send the user
 * back. We only ever emit a same-origin path here, never an absolute URL.
 */
function redirectToLogin(request: NextRequest): NextResponse {
  const target = request.nextUrl.pathname + request.nextUrl.search;
  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1) API proxy (login endpoints included — they must work before a session).
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return proxyApi(request);
  }

  // 2) The login page is always reachable — otherwise we would loop.
  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  // 3) Everything else is private.
  if (await isAuthenticated(request)) {
    return NextResponse.next();
  }
  return redirectToLogin(request);
}

export const config = {
  // Run on every route EXCEPT Next.js internals and static files, so page
  // access control cannot be bypassed by a direct URL, and so the login page
  // still loads its CSS/JS without a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
