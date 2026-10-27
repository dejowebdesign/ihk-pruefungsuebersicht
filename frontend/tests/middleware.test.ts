import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// The middleware is both the API proxy and the page gate, so it is the single
// place where a request can be mis-forwarded or a page can leak. These tests
// exercise it directly against a stubbed backend.

const BACKEND = "http://backend.test";

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://web.test"), { ...rest, headers });
}

/** Stub global fetch; returns the recorded calls for assertions. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
  return calls;
}

function meResponse(role: "admin" | "examiner" | null) {
  return new Response(JSON.stringify(role ? { user: { username: "u", role } } : {}), {
    status: role ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.BACKEND_URL = BACKEND;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BACKEND_URL;
});

describe("middleware API proxy", () => {
  it("forwards DELETE without stale framing headers (regression: 502)", async () => {
    // A DELETE as a browser sends it: content-length present, no body.
    const calls = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await middleware(
      req("/api/oral/exams/abc?confirm=true", {
        method: "DELETE",
        headers: { "content-length": "0", cookie: "ihk_session=tok" },
      }),
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BACKEND}/api/oral/exams/abc?confirm=true`);
    expect(calls[0].init.method).toBe("DELETE");

    // The framing headers must not be forwarded, or undici rejects the fetch
    // with RequestContentLengthMismatchError.
    const sent = new Headers(calls[0].init.headers);
    expect(sent.get("content-length")).toBeNull();
    expect(sent.get("transfer-encoding")).toBeNull();
    // The session cookie must survive so the backend can authorize.
    expect(sent.get("cookie")).toBe("ihk_session=tok");
    // The original Host must not be forwarded.
    expect(sent.get("host")).toBeNull();
  });

  it("forwards a DELETE that carries a body", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));

    const res = await middleware(
      req("/api/oral/exams/abc", { method: "DELETE", body: "{}" }),
    );

    expect(res.status).toBe(204);
    expect(calls[0].init.body).toBe("{}");
  });

  it("forwards POST bodies and passes the backend status through", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );

    const res = await middleware(
      req("/api/users", {
        method: "POST",
        body: JSON.stringify({ username: "x" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(403);
    expect(calls[0].init.body).toBe('{"username":"x"}');
  });

  it("returns 502 when the backend is unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    const res = await middleware(req("/api/oral/exams/abc", { method: "DELETE" }));

    expect(res.status).toBe(502);
  });
});

describe("middleware page authorization", () => {
  it("sends an anonymous visitor to /login with a next parameter", async () => {
    stubFetch(() => meResponse(null));

    const res = await middleware(req("/fragen"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/fragen");
  });

  it("lets an admin open an admin-only page", async () => {
    stubFetch(() => meResponse("admin"));

    const res = await middleware(req("/admin/users", { cookie: "ihk_session=tok" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets an examiner open their allowed pages", async () => {
    for (const path of [
      "/",
      "/ihk/abc",
      "/muendliche-pruefung",
      "/muendliche-pruefung/abc",
    ]) {
      stubFetch(() => meResponse("examiner"));
      const res = await middleware(req(path, { cookie: "ihk_session=tok" }));
      expect(res.status, `examiner should reach ${path}`).toBe(200);
    }
  });

  it("redirects an examiner away from every blocked page", async () => {
    for (const path of [
      "/fragen",
      "/fallbeispiele",
      "/vergleich",
      "/admin",
      "/admin/users",
    ]) {
      stubFetch(() => meResponse("examiner"));
      const res = await middleware(req(path, { cookie: "ihk_session=tok" }));
      expect(res.status, `examiner must be blocked from ${path}`).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    }
  });

  it("treats a stale participant session as an examiner (post-migration safety)", async () => {
    // Even if the backend still reported the retired role, the page gate must
    // not hand it admin access — it falls back to the examiner area.
    stubFetch(() => new Response(JSON.stringify({ user: { username: "u", role: "participant" } }), { status: 200 }));
    const allowed = await middleware(req("/", { cookie: "ihk_session=tok" }));
    expect(allowed.status).toBe(200);

    stubFetch(() => new Response(JSON.stringify({ user: { username: "u", role: "participant" } }), { status: 200 }));
    const blocked = await middleware(req("/admin/users", { cookie: "ihk_session=tok" }));
    expect(blocked.status).toBe(307);
  });

  it("bounces a signed-in user away from /login", async () => {
    stubFetch(() => meResponse("admin"));

    const res = await middleware(req("/login", { cookie: "ihk_session=tok" }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("does not gate static assets", async () => {
    const calls = stubFetch(() => meResponse(null));

    const res = await middleware(req("/_next/static/chunk.js"));

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0); // no identity round-trip for assets
  });
});
