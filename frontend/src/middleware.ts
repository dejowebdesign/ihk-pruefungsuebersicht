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
  // Strip host so fetch uses the backend host header.
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  // Only forward a request body when the client actually sent one. Bodyless
  // non-GET requests (e.g. DELETE) arrive with an empty stream; calling
  // request.text() returns "" and, combined with a forwarded Content-Length: 0
  // / Content-Type header, makes the upstream fetch throw (surfaced as a 502).
  // Skipping the body for empty requests lets DELETE through cleanly.
  const contentLength = request.headers.get("content-length");
  if (request.method !== "GET" && request.method !== "HEAD" && contentLength && contentLength !== "0") {
    init.body = await request.text();
  }

  try {
    const res = await fetch(backendUrl, init);
    const respHeaders = new Headers();
    res.headers.forEach((v, k) => {
      // Drop transfer-encoding; NextResponse sets its own.
      if (k.toLowerCase() !== "transfer-encoding") respHeaders.set(k, v);
    });
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
