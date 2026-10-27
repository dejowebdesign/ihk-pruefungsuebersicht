// Authentication, user management and role enforcement — integration tests
// against the real Hono app on an isolated SQLite database.
//
// Covers: admin/participant login, invalid credentials, deactivated accounts,
// role rights, blocked pages/endpoints, own-vs-foreign exam access, session
// revocation after deactivation, and password-hash protection.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { createApp } from "../src/api/app";
import { SESSION_COOKIE, hashToken, bootstrapAdmin } from "../src/auth/service";
import { hashPassword } from "../src/auth/passwords";

const TEST_TOKEN = "auth-test-token-do-not-use-in-prod-0123456789abcdef";
const ADMIN_PW = "admin-passwort-123";
const PARTICIPANT_PW = "teilnehmer-passwort-456";

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-auth-test-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.ADMIN_TOKEN = TEST_TOKEN;
  process.env.ADMIN_PASSWORD = ADMIN_PW;
  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env },
  });
  client = new PrismaClient();
  setPrismaClient(client);
  await seedOralPool(client);
  app = createApp();
}, 120_000);

afterAll(async () => {
  await disconnectPrisma();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  delete process.env.ADMIN_PASSWORD;
});

/** Log in and return the session cookie + user payload. */
async function login(username: string, password: string) {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  const body = res.status === 200 ? await res.json() : null;
  return { res, cookie: match ? `${SESSION_COOKIE}=${match[1]}` : null, body };
}

/** Request with a session cookie. */
function asUser(cookie: string | null, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (cookie) headers.set("cookie", cookie);
  return app.request(path, { ...init, headers });
}

const adminToken = () => ({ Authorization: `Bearer ${TEST_TOKEN}` });

describe("admin login", () => {
  it("bootstraps an admin account from ADMIN_PASSWORD", async () => {
    const r = await bootstrapAdmin(client);
    expect(r.created).toBe(true);
    expect(r.username).toBe("admin");
  });

  it("bootstrap is a no-op once an admin exists", async () => {
    const r = await bootstrapAdmin(client);
    expect(r.created).toBe(false);
  });

  it("logs in with correct credentials and sets an httpOnly cookie", async () => {
    const { res, cookie, body } = await login("admin", ADMIN_PW);
    expect(res.status).toBe(200);
    expect(cookie).toBeTruthy();
    expect(body.user.role).toBe("admin");
    expect(body.user.username).toBe("admin");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("never returns the password hash in any auth response", async () => {
    const { res, cookie, body } = await login("admin", ADMIN_PW);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("scrypt$");
    const me = await asUser(cookie, "/api/auth/me");
    const meRaw = await me.text();
    expect(meRaw).not.toContain("passwordHash");
    expect(meRaw).not.toContain("scrypt$");
  });

  it("rejects a wrong password with 401", async () => {
    const { res } = await login("admin", "definitely-wrong");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown user with 401", async () => {
    const { res } = await login("nobody", ADMIN_PW);
    expect(res.status).toBe(401);
  });

  it("rejects a missing password with 401 (no crash)", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("the legacy ADMIN_TOKEN still authenticates as admin", async () => {
    const res = await app.request("/api/admin/status", { headers: adminToken() });
    expect(res.status).toBe(200);
  });
});

describe("password hashing", () => {
  it("stores only a scrypt hash, never the plaintext", async () => {
    const row = await client.user.findUnique({ where: { username: "admin" } });
    expect(row).toBeTruthy();
    expect(row!.passwordHash).not.toBe(ADMIN_PW);
    expect(row!.passwordHash.startsWith("scrypt$")).toBe(true);
    // No plaintext password anywhere in the row.
    expect(JSON.stringify(row)).not.toContain(ADMIN_PW);
  });

  it("hashes are salted (same password → different hashes)", async () => {
    const a = await hashPassword("identical-password");
    const b = await hashPassword("identical-password");
    expect(a).not.toBe(b);
  });

  it("sessions store only a token hash, never the raw cookie value", async () => {
    const { cookie } = await login("admin", ADMIN_PW);
    const raw = decodeURIComponent(cookie!.split("=")[1]);
    const stored = await client.session.findUnique({ where: { tokenHash: hashToken(raw) } });
    expect(stored).toBeTruthy();
    expect(stored!.tokenHash).not.toBe(raw);
    const all = await client.session.findMany({ select: { tokenHash: true } });
    expect(all.some((s) => s.tokenHash === raw)).toBe(false);
  });
});

describe("participant management by the admin", () => {
  let participantId: string;
  let participantCookie: string | null;

  it("creates a participant account", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "teilnehmer1",
        password: PARTICIPANT_PW,
        role: "participant",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    participantId = body.user.id;
    expect(body.user.role).toBe("participant");
    expect(body.user.active).toBe(true);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("lists users without any hash", async () => {
    const res = await app.request("/api/users", { headers: adminToken() });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("teilnehmer1");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("scrypt$");
  });

  it("rejects a duplicate username with 400", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "teilnehmer1", password: PARTICIPANT_PW, role: "participant" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a short password with 400", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "kurzpw", password: "abc", role: "participant" }),
    });
    expect(res.status).toBe(400);
  });

  it("defaults to the participant role when the role is absent or bogus", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ohnerolle", password: PARTICIPANT_PW, role: "superadmin" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe("participant");
  });

  it("participant can log in", async () => {
    const { res, cookie, body } = await login("teilnehmer1", PARTICIPANT_PW);
    expect(res.status).toBe(200);
    expect(body.user.role).toBe("participant");
    participantCookie = cookie;
  });

  it("admin can reset a participant password, and the old one stops working", async () => {
    const newPw = "ganz-neues-passwort-789";
    const res = await app.request(`/api/users/${participantId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPw }),
    });
    expect(res.status).toBe(200);
    expect((await login("teilnehmer1", newPw)).res.status).toBe(200);
    expect((await login("teilnehmer1", PARTICIPANT_PW)).res.status).toBe(401);
  });

  it("deactivating a participant revokes their live session immediately", async () => {
    // fresh session, then deactivate
    const { cookie } = await login("teilnehmer1", "ganz-neues-passwort-789");
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(200);

    const off = await app.request(`/api/users/${participantId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(off.status).toBe(200);
    expect((await off.json()).user.active).toBe(false);

    // The very next request with the old cookie is rejected.
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(401);
    expect((await asUser(cookie, "/api/oral/exams")).status).toBe(401);
  });

  it("a deactivated participant cannot log in", async () => {
    const { res } = await login("teilnehmer1", "ganz-neues-passwort-789");
    expect(res.status).toBe(401);
  });

  it("reactivating restores login and keeps the account row", async () => {
    const on = await app.request(`/api/users/${participantId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    expect(on.status).toBe(200);
    const { res, cookie } = await login("teilnehmer1", "ganz-neues-passwort-789");
    expect(res.status).toBe(200);
    participantCookie = cookie;
  });

  it("DELETE deactivates (soft) instead of destroying the row", async () => {
    const res = await app.request(`/api/users/${participantId}`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.active).toBe(false);
    const row = await client.user.findUnique({ where: { id: participantId } });
    expect(row).toBeTruthy(); // still present, just deactivated
  });

  it("only admins may manage users (participant → 403, anonymous → 401)", async () => {
    await app.request(`/api/users/${participantId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const { cookie } = await login("teilnehmer1", "ganz-neues-passwort-789");
    const forbidden = await asUser(cookie, "/api/users");
    expect(forbidden.status).toBe(403);
    const anonymous = await app.request("/api/users");
    expect(anonymous.status).toBe(401);
  });

  it("a participant cannot escalate its own role", async () => {
    const { cookie } = await login("teilnehmer1", "ganz-neues-passwort-789");
    const res = await asUser(cookie, `/api/users/${participantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
    const row = await client.user.findUnique({ where: { id: participantId } });
    expect(row!.role).toBe("participant");
  });
});

describe("last active admin is protected", () => {
  it("cannot be deactivated", async () => {
    const admin = await client.user.findUnique({ where: { username: "admin" } });
    const res = await app.request(`/api/users/${admin!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/last active administrator/i);
    const after = await client.user.findUnique({ where: { id: admin!.id } });
    expect(after!.active).toBe(true);
  });

  it("cannot be demoted", async () => {
    const admin = await client.user.findUnique({ where: { username: "admin" } });
    const res = await app.request(`/api/users/${admin!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "participant" }),
    });
    expect(res.status).toBe(400);
    const after = await client.user.findUnique({ where: { id: admin!.id } });
    expect(after!.role).toBe("admin");
  });

  it("cannot be removed via DELETE", async () => {
    const admin = await client.user.findUnique({ where: { username: "admin" } });
    const res = await app.request(`/api/users/${admin!.id}`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(400);
    expect((await client.user.findUnique({ where: { id: admin!.id } }))!.active).toBe(true);
  });

  it("admin access still works after all the management attempts", async () => {
    const res = await app.request("/api/admin/status", { headers: adminToken() });
    expect(res.status).toBe(200);
  });
});

describe("role enforcement on pages' backing endpoints", () => {
  let participantCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    const admin = await login("admin", ADMIN_PW);
    adminCookie = admin.cookie!;
    // Make sure the participant is active and has a known password.
    const p = await client.user.findUnique({ where: { username: "teilnehmer1" } });
    await app.request(`/api/users/${p!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true, password: "teilnehmer-final-999" }),
    });
    participantCookie = (await login("teilnehmer1", "teilnehmer-final-999")).cookie!;
  });

  const ADMIN_ONLY = [
    "/api/ihk/anything", // /ihk/:id detail page
    "/api/questions", // /fragen
    "/api/questions/x",
    "/api/case-examples", // /fallbeispiele
    "/api/sheets",
    "/api/import/status",
    "/api/import/runs",
    "/api/users",
  ];

  for (const path of ADMIN_ONLY) {
    it(`blocks participant access to ${path} (403)`, async () => {
      expect((await asUser(participantCookie, path)).status).toBe(403);
    });
    it(`blocks anonymous access to ${path} (401)`, async () => {
      expect((await app.request(path)).status).toBe(401);
    });
  }

  // The IHK read endpoints are PUBLIC (they back the start page `/`, one of
  // the two areas participants may use). This database has no import run, so a
  // successful call answers 503 "no data available yet" — what matters here is
  // that the gate does NOT answer 401/403.
  it("does not gate the participant out of the start-page IHK list", async () => {
    const res = await asUser(participantCookie, "/api/ihk?limit=5");
    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("does not gate the participant out of IHK search", async () => {
    const res = await asUser(participantCookie, "/api/ihk/search?q=aach");
    expect(res.status).toBe(503);
  });

  it("does not gate the participant out of the public API root", async () => {
    expect((await asUser(participantCookie, "/api")).status).toBe(200);
  });

  it("gates the IHK detail endpoint: participant 403, admin passes through", async () => {
    expect((await asUser(participantCookie, "/api/ihk/anything")).status).toBe(403);
    // The admin reaches the handler, which reports the missing data (503) —
    // anything other than 401/403 proves the gate let it through.
    const adminRes = await asUser(adminCookie, "/api/ihk/anything");
    expect(adminRes.status).not.toBe(403);
    expect(adminRes.status).not.toBe(401);
  });

  it("participants cannot write to oral exams (403)", async () => {
    const res = await asUser(participantCookie, "/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Nicht erlaubt" }),
    });
    expect(res.status).toBe(403);
  });

  it("participants cannot rate questions (403)", async () => {
    const res = await asUser(participantCookie, "/api/oral/exams/whatever/questions/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "richtig" }),
    });
    expect(res.status).toBe(403);
  });

  it("participants cannot delete exams (403)", async () => {
    const res = await asUser(participantCookie, "/api/oral/exams/whatever?confirm=true", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  it("participants cannot seed the pool (403)", async () => {
    expect((await asUser(participantCookie, "/api/oral/seed", { method: "POST" })).status).toBe(403);
  });
});

describe("participants only see their own exams", () => {
  let participantCookie: string;
  let ownExamId: string;
  let foreignExamId: string;

  beforeAll(async () => {
    const p = await client.user.findUnique({ where: { username: "teilnehmer1" } });
    // An exam owned by the participant …
    ownExamId = (
      await createExam(
        client,
        { candidateName: "Eigene Prüfung", userId: p!.id },
        mulberry32(4242),
      )
    ).examId;
    // … and one owned by somebody else (an admin-created exam has no owner).
    foreignExamId = (
      await createExam(client, { candidateName: "Fremde Prüfung" }, mulberry32(777))
    ).examId;
    participantCookie = (await login("teilnehmer1", "teilnehmer-final-999")).cookie!;
  });

  it("the list contains only the participant's own exams", async () => {
    const res = await asUser(participantCookie, "/api/oral/exams?limit=50");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((e: { id: string }) => e.id);
    expect(ids).toContain(ownExamId);
    expect(ids).not.toContain(foreignExamId);
    expect(body.pagination.total).toBe(ids.length);
  });

  it("the participant can read their own exam", async () => {
    const res = await asUser(participantCookie, `/api/oral/exams/${ownExamId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).candidate.name).toBe("Eigene Prüfung");
  });

  it("the participant cannot read a foreign exam (404, not 403)", async () => {
    expect((await asUser(participantCookie, `/api/oral/exams/${foreignExamId}`)).status).toBe(404);
  });

  it("the participant cannot read a foreign exam score", async () => {
    expect((await asUser(participantCookie, `/api/oral/exams/${foreignExamId}/score`)).status).toBe(404);
  });

  it("the admin sees both exams", async () => {
    const res = await app.request("/api/oral/exams?limit=50", { headers: adminToken() });
    const ids = (await res.json()).data.map((e: { id: string }) => e.id);
    expect(ids).toContain(ownExamId);
    expect(ids).toContain(foreignExamId);
  });

  it("ownership cannot be spoofed through the request body", async () => {
    // An admin creating an exam while passing userId is still recorded as the
    // identity-derived owner (null for the legacy token), not the body value.
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Spoof Versuch", userId: "some-other-id" }),
    });
    expect(res.status).toBe(201);
    const created = await client.oralExam.findUnique({
      where: { id: (await res.json()).examId },
    });
    expect(created!.userId).toBeNull();
  });
});

describe("session revocation", () => {
  it("logout invalidates the session server-side", async () => {
    const { cookie } = await login("admin", ADMIN_PW);
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(200);
    const out = await asUser(cookie, "/api/auth/logout", { method: "POST" });
    expect(out.status).toBe(200);
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(401);
  });

  it("a password reset revokes existing sessions of that user", async () => {
    const p = await client.user.findUnique({ where: { username: "teilnehmer1" } });
    const { cookie } = await login("teilnehmer1", "teilnehmer-final-999");
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(200);

    await app.request(`/api/users/${p!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: "teilnehmer-final-999" }),
    });
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(401);
  });

  it("a revoked session row cannot be replayed after logout", async () => {
    const { cookie } = await login("admin", ADMIN_PW);
    const raw = decodeURIComponent(cookie!.split("=")[1]);
    await asUser(cookie, "/api/auth/logout", { method: "POST" });
    const row = await client.session.findUnique({ where: { tokenHash: hashToken(raw) } });
    expect(row!.revokedAt).not.toBeNull();
    expect((await asUser(cookie, "/api/oral/exams")).status).toBe(401);
  });

  it("an unknown cookie is rejected", async () => {
    expect((await asUser(`${SESSION_COOKIE}=deadbeef`, "/api/auth/me")).status).toBe(401);
  });
});
