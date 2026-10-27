import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Runtime API proxy: forwards /api/* to the Hono backend (BACKEND_URL).
// We use middleware instead of next.config rewrites() because rewrites are
// baked into the build, while middleware reads env at request time — so the
// backend URL stays configurable via the BACKEND_URL env var in Docker.
export async function middleware(request: NextRequest) {
  const backend = process.env.BACKEND_URL || "http://localhost:3001";
  const path = request.nextUrl.pathname.replace(/^\/api/, "");
  const url = `${backend}/api${path}${request.nextUrl.search}`;
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

export const config = {
  matcher: "/api/:path*",
};
