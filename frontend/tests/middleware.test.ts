// Tests for the middleware's page access control and the open-redirect guard.
//
// The middleware decides which pages a browser may render and proxies /api/*.
// `isAuthenticated` calls the backend's /api/auth/me, so we stub global fetch
// to simulate authenticated / unauthenticated sessions and assert the redirect
// behaviour — including that there is no loop and no open redirect.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";
import { safeNextPath, DEFAULT_REDIRECT } from "@/lib/safe-redirect";

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, "https://ihk.example.com"), { headers });
}

/** Normalise the many shapes `fetch` accepts into a URL string. */
function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

/** Stub fetch so /api/auth/me reports the given auth state. */
function stubAuth(authenticated: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = fetchUrl(input);
    if (url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ authenticated, username: authenticated ? "admin" : null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  process.env.BACKEND_URL = "http://backend.internal:3001";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_URL;
});

describe("middleware — unauthenticated visitors are redirected to login", () => {
  const PROTECTED_PAGES = [
    "/",
    "/fragen",
    "/fallbeispiele",
    "/vergleich",
    "/muendliche-pruefung",
    "/muendliche-pruefung/abc123",
    "/ihk/xyz789",
    "/admin",
  ];

  for (const path of PROTECTED_PAGES) {
    it(`${path} → redirect to /admin/login with next=${path}`, async () => {
      stubAuth(false);
      const res = await middleware(makeRequest(path));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/admin/login");
      expect(url.searchParams.get("next")).toBe(path);
      // Redirect target must stay on our own origin.
      expect(url.origin).toBe("https://ihk.example.com");
    });
  }

  it("preserves the query string in next", async () => {
    stubAuth(false);
    const res = await middleware(makeRequest("/fragen?page=2&q=recht"));
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("next")).toBe("/fragen?page=2&q=recht");
  });
});

describe("middleware — no redirect loop", () => {
  it("the login page is served without a session", async () => {
    stubAuth(false);
    const res = await middleware(makeRequest("/admin/login"));
    // NextResponse.next() → no location header.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("the login page is served even when already authenticated", async () => {
    stubAuth(true);
    const res = await middleware(makeRequest("/admin/login"));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — authenticated visitors reach every page", () => {
  for (const path of ["/", "/fragen", "/muendliche-pruefung/abc", "/ihk/x", "/admin"]) {
    it(`${path} is served with a session`, async () => {
      stubAuth(true);
      const res = await middleware(makeRequest(path, { cookie: "ihk_admin_session=valid" }));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    });
  }
});

describe("middleware — fails closed when the backend is unreachable", () => {
  it("redirects to login instead of exposing the page", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await middleware(makeRequest("/fragen"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });
});

describe("middleware — API proxy is preserved", () => {
  it("forwards /api/* to the backend and returns its response", async () => {
    const spy = stubAuth(false);
    const res = await middleware(makeRequest("/api/ihk?limit=5"));
    const called = spy.mock.calls.map((c) => fetchUrl(c[0]));
    expect(called.some((u) => u.startsWith("http://backend.internal:3001/api/ihk?limit=5"))).toBe(true);
    // Proxied response is passed through (not a login redirect).
    expect(res.headers.get("location")).toBeNull();
  });

  it("proxies the login endpoint without requiring a session first", async () => {
    const spy = stubAuth(false);
    await middleware(makeRequest("/api/auth/login"));
    const called = spy.mock.calls.map((c) => fetchUrl(c[0]));
    expect(called.some((u) => u.includes("/api/auth/login"))).toBe(true);
  });
});

describe("middleware — matcher covers all pages", () => {
  it("does not match Next internals or static files", () => {
    const pattern = new RegExp(`^${(config.matcher[0] as string)}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/fragen")).toBe(true);
    expect(pattern.test("/ihk/abc")).toBe(true);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/_next/image")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
  });
});

describe("safeNextPath — open-redirect protection", () => {
  it("keeps valid internal paths", () => {
    expect(safeNextPath("/fragen")).toBe("/fragen");
    expect(safeNextPath("/muendliche-pruefung/abc?x=1")).toBe("/muendliche-pruefung/abc?x=1");
  });

  it("rejects absolute external URLs", () => {
    for (const bad of [
      "https://evil.example.com",
      "http://evil.example.com/x",
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://evil",
    ]) {
      expect(safeNextPath(bad)).toBe(DEFAULT_REDIRECT);
    }
  });

  it("rejects protocol-relative and backslash tricks", () => {
    for (const bad of ["//evil.example.com", "/\\evil.example.com", "/foo\\bar", "\\\\evil"]) {
      expect(safeNextPath(bad)).toBe(DEFAULT_REDIRECT);
    }
  });

  it("rejects empty, whitespace and non-path values", () => {
    for (const bad of ["", "   ", "fragen", null, undefined]) {
      expect(safeNextPath(bad)).toBe(DEFAULT_REDIRECT);
    }
  });

  it("never bounces back to the login page itself", () => {
    expect(safeNextPath("/admin/login")).toBe(DEFAULT_REDIRECT);
    expect(safeNextPath("/admin/login?next=/")).toBe(DEFAULT_REDIRECT);
  });
});
