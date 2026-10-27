// Admin login / session / CSRF / rate-limit tests.
//
// Exercises the real app via Hono's app.request(): no mocks. Covers the nine
// required cases from the task:
//   1 valid login, 2 invalid credentials, 3 write without auth, 4 access after
//   login, 5 logout invalidates, 6 expired/invalid session, 7 CSRF, 8 rate
//   limiting, 9 legacy ADMIN_TOKEN clients keep working.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createApp } from "../src/api/app";
import { hashPassword } from "../src/api/passwords";
import { ADMIN_SESSION_COOKIE } from "../src/api/admin-auth";
import { destroyAllSessions, createSession } from "../src/api/session";
import { resetRateLimiter } from "../src/api/rate-limit";

const LEGACY_TOKEN = "legacy-admin-token-do-not-use-in-prod-0123456789ab";
const ADMIN_USER = "admin";
const ADMIN_PASS = "dbasicherheit26";

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-auth-test-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.ADMIN_TOKEN = LEGACY_TOKEN;
  process.env.ADMIN_USERNAME = ADMIN_USER;
  // Store only the scrypt hash — never the plaintext.
  process.env.ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASS);
  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_LOGIN_MAX_ATTEMPTS = "3";
  process.env.ADMIN_LOGIN_WINDOW_MINUTES = "15";

  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env },
  });
  client = new PrismaClient();
  setPrismaClient(client);
  await seedOralPool(client);
  app = createApp();
});

afterAll(async () => {
  await disconnectPrisma();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_TOKEN;
  destroyAllSessions();
});

beforeEach(() => {
  destroyAllSessions();
  resetRateLimiter();
});

/** Extract the session cookie value from a login response, if any. */
function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const m = raw.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

async function login(password = ADMIN_PASS, username = ADMIN_USER) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ username, password }),
  });
}

describe("1. login with valid credentials", () => {
  it("returns 200, sets an HttpOnly session cookie, reports the user", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.username).toBe(ADMIN_USER);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(ADMIN_SESSION_COOKIE);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");
    expect(sessionCookie(res)).toBeTruthy();
  });

  it("GET /api/auth/me reflects the session", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/auth/me", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ authenticated: true, username: ADMIN_USER });
  });

  it("me is unauthenticated without a cookie", async () => {
    const res = await app.request("/api/auth/me");
    expect((await res.json()).authenticated).toBe(false);
  });
});

describe("2. invalid credentials are rejected", () => {
  it("wrong password → 401 with a generic message", async () => {
    const res = await login("wrong-password");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid credentials");
    // Must not disclose which field was wrong.
    expect(JSON.stringify(body).toLowerCase()).not.toContain("password");
    expect(sessionCookie(res)).toBeNull();
  });

  it("wrong username → 401 with the same generic message", async () => {
    const res = await login(ADMIN_PASS, "root");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid credentials");
  });

  it("missing fields → 400", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: ADMIN_USER }),
    });
    expect(res.status).toBe(400);
  });
});

describe("3. protected writes are refused without a valid login", () => {
  it("POST /api/admin/import without credentials → 401", async () => {
    const res = await app.request("/api/admin/import", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /api/oral/exams without credentials → 401", async () => {
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "X" }),
    });
    expect(res.status).toBe(401);
  });

  it("a forged/unknown session cookie → 401", async () => {
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${ADMIN_SESSION_COOKIE}=not-a-real-token` },
      body: JSON.stringify({ candidateName: "X" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("4. access succeeds after login (server-side enforcement)", () => {
  it("creates an oral exam with the session cookie", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`,
        Origin: "http://localhost",
      },
      body: JSON.stringify({ candidateName: "Session Prüfling" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).examId).toBeTruthy();
  });

  it("GET /api/admin/status works with the session cookie", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/admin/status", {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("5. logout invalidates the session server-side", () => {
  it("after logout the cookie no longer grants access", async () => {
    const cookie = sessionCookie(await login())!;
    const before = await app.request("/api/admin/status", {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    });
    expect(before.status).toBe(200);

    const out = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`, Origin: "http://localhost" },
    });
    expect(out.status).toBe(200);

    // Replaying the same cookie must now fail — the session is gone server-side.
    const after = await app.request("/api/admin/status", {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    });
    expect(after.status).toBe(401);
  });
});

describe("6. expired / invalid sessions are rejected", () => {
  it("an expired session is treated as unauthenticated", async () => {
    const mod = await import("../src/api/session");
    const s = createSession(ADMIN_USER); // live
    const expired = createSession(ADMIN_USER, -1000); // already expired
    expect(mod.getSession(expired.token)).toBeNull();
    // A live session still works.
    expect(mod.getSession(s.token)).not.toBeNull();

    const res = await app.request("/api/admin/status", {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${expired.token}` },
    });
    expect(res.status).toBe(401);
  });

  it("sweepExpiredSessions removes stale entries", async () => {
    const mod = await import("../src/api/session");
    mod.destroyAllSessions();
    createSession(ADMIN_USER, -1000);
    expect(mod.sweepExpiredSessions()).toBeGreaterThanOrEqual(1);
  });
});

describe("7. CSRF protection for cookie-authenticated writes", () => {
  it("rejects a cookie-authenticated write with a mismatched Origin → 403", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`,
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ candidateName: "CSRF" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cookie-authenticated write with no Origin/Referer → 403", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
      body: JSON.stringify({ candidateName: "CSRF" }),
    });
    expect(res.status).toBe(403);
  });

  it("allows a cookie-authenticated write from an allowed Origin", async () => {
    const cookie = sessionCookie(await login())!;
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`,
        Origin: "http://localhost",
      },
      body: JSON.stringify({ candidateName: "CSRF OK" }),
    });
    expect(res.status).toBe(201);
  });

  it("login itself is CSRF-checked", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    expect(res.status).toBe(403);
  });

  it("honours X-Forwarded-Host from the reverse proxy (public origin)", async () => {
    const cookie = sessionCookie(await login())!;
    // Browser talks to https://ihk.example.com; the proxy forwards that host.
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`,
        Origin: "https://ihk.example.com",
        "x-forwarded-host": "ihk.example.com",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ candidateName: "Proxy" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("8. rate limiting on repeated failures", () => {
  it("locks out after ADMIN_LOGIN_MAX_ATTEMPTS failures → 429", async () => {
    // max = 3 (set in beforeAll)
    for (let i = 0; i < 3; i++) {
      const res = await login("wrong");
      expect(res.status).toBe(401);
    }
    const locked = await login("wrong");
    expect(locked.status).toBe(429);

    // Even the CORRECT password is refused while locked out.
    const correct = await login(ADMIN_PASS);
    expect(correct.status).toBe(429);
  });

  it("a successful login resets the failure counter", async () => {
    await login("wrong");
    await login("wrong");
    const ok = await login(ADMIN_PASS);
    expect(ok.status).toBe(200);
    // Counter cleared → a subsequent failure is 401, not 429.
    const again = await login("wrong");
    expect(again.status).toBe(401);
  });
});

describe("9. legacy ADMIN_TOKEN clients keep working", () => {
  it("Bearer ADMIN_TOKEN still authorizes protected endpoints", async () => {
    const res = await app.request("/api/admin/status", {
      headers: { Authorization: `Bearer ${LEGACY_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("Bearer token is exempt from the CSRF check (no Origin needed)", async () => {
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LEGACY_TOKEN}` },
      body: JSON.stringify({ candidateName: "Legacy Client" }),
    });
    expect(res.status).toBe(201);
  });

  it("a wrong bearer token still yields 401", async () => {
    const res = await app.request("/api/admin/status", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("fails closed when nothing is configured", () => {
  afterEach(() => {
    process.env.ADMIN_TOKEN = LEGACY_TOKEN;
    process.env.ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASS);
  });

  it("admin endpoints return 503 when neither token nor password is set", async () => {
    delete process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_PASSWORD;
    const res = await app.request("/api/admin/status", {
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(503);
  });
});
