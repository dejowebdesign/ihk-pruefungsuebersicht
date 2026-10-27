// Authentication, user management and role enforcement — integration tests
// against the real Hono app on an isolated SQLite database.
//
// Covers: admin/examiner login, invalid credentials, deactivated accounts,
// role rights, blocked pages/endpoints, the examiner's shared access to all
// exams, session revocation after deactivation, and password-hash protection.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { createApp } from "../src/api/app";
import {
  SESSION_COOKIE,
  hashToken,
  bootstrapAdmin,
  ROLES,
  isRole,
  DEFAULT_ROLE,
} from "../src/auth/service";
import { hashPassword } from "../src/auth/passwords";

const TEST_TOKEN = "auth-test-token-do-not-use-in-prod-0123456789abcdef";
const ADMIN_PW = "admin-passwort-123";
const EXAMINER_PW = "pruefer-passwort-456";

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

describe("role model", () => {
  it("exposes exactly admin and examiner as valid roles", () => {
    expect(ROLES).toEqual(["admin", "examiner"]);
    expect(isRole("admin")).toBe(true);
    expect(isRole("examiner")).toBe(true);
    // The retired role is rejected everywhere a role is validated.
    expect(isRole("participant")).toBe(false);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole("")).toBe(false);
  });

  it("defaults new users to the examiner role", () => {
    expect(DEFAULT_ROLE).toBe("examiner");
  });

  it("has no participant rows in a freshly pushed database", async () => {
    expect(await client.user.count({ where: { role: "participant" } })).toBe(0);
  });
});

describe("participant → examiner migration", () => {
  // The migration is verified against a database that genuinely holds
  // "participant" rows: the rows are inserted first, then the real
  // migration.sql is executed, then conversion AND data preservation are
  // asserted. This is the scenario a live install upgrades from.
  let migDb: string;
  let migClient: PrismaClient;

  const MIGRATION = path.resolve(
    __dirname,
    "../prisma/migrations/20261027000000_examiner_role/migration.sql",
  );

  beforeAll(async () => {
    migDb = path.join(os.tmpdir(), `ihk-migration-test-${Date.now()}.db`);
    execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: `file:${migDb}` },
    });
    migClient = new PrismaClient({ datasources: { db: { url: `file:${migDb}` } } });
    await seedOralPool(migClient);

    // ── pre-migration state ──────────────────────────────────────────────
    const now = new Date();
    for (const [id, username, role, active] of [
      ["m-admin", "mig-admin", "admin", true],
      ["m-bea", "mig-bea", "participant", true],
      ["m-carla", "mig-carla", "participant", true],
      ["m-dora", "mig-dora", "participant", false],
    ] as const) {
      await migClient.$executeRawUnsafe(
        `INSERT INTO "User" ("id","username","passwordHash","role","active","createdAt","updatedAt","disabledAt")
         VALUES (?,?,?,?,?,?,?,?)`,
        id,
        username,
        `scrypt$HASH_${id}`,
        role,
        active ? 1 : 0,
        now.toISOString(),
        now.toISOString(),
        active ? null : now.toISOString(),
      );
    }
    await migClient.$executeRawUnsafe(
      `INSERT INTO "Session" ("id","tokenHash","userId","createdAt","expiresAt","revokedAt")
       VALUES ('m-sess','hash-m-sess','m-bea',?,?,NULL)`,
      now.toISOString(),
      now.toISOString(),
    );
    await migClient.$executeRawUnsafe(
      `INSERT INTO "OralCandidate" ("id","name","createdAt") VALUES ('m-cand','Bea Beispiel',?)`,
      now.toISOString(),
    );
    await migClient.$executeRawUnsafe(
      `INSERT INTO "OralExam" ("id","candidateId","userId","status","createdAt","updatedAt","maxPoints","totalPoints","percent","result","examiner")
       VALUES ('m-exam','m-cand','m-bea','completed',?,?,100,80,80.0,'Bestanden','Alt Pruefer')`,
      now.toISOString(),
      now.toISOString(),
    );
    const theme = await migClient.oralTheme.findFirst({ orderBy: { orderKey: "asc" } });
    const question = await migClient.oralQuestion.findFirst({ where: { themeId: theme!.id } });
    await migClient.$executeRawUnsafe(
      `INSERT INTO "OralExamQuestion" ("id","examId","questionId","orderKey","themeName","weight","rating","points","note")
       VALUES ('m-item','m-exam',?,1,'Alt Thema',10,'richtig',10,'alte Notiz')`,
      question!.id,
    );
  }, 120_000);

  afterAll(async () => {
    await migClient.$disconnect();
    if (fs.existsSync(migDb)) fs.unlinkSync(migDb);
  });

  it("converts participant accounts and preserves all other data", async () => {
    // Snapshot everything that must NOT change.
    const usersBefore = await migClient.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id","username","passwordHash","active","disabledAt" FROM "User" ORDER BY "id"`,
    );
    const sessionsBefore = await migClient.$queryRawUnsafe<unknown[]>(`SELECT * FROM "Session"`);
    const examsBefore = await migClient.$queryRawUnsafe<unknown[]>(`SELECT * FROM "OralExam"`);
    const itemsBefore = await migClient.$queryRawUnsafe<unknown[]>(`SELECT * FROM "OralExamQuestion"`);
    const poolBefore = await migClient.oralQuestion.count();
    const themesBefore = await migClient.oralTheme.count();

    const rolesBefore = await migClient.$queryRawUnsafe<Array<{ username: string; role: string }>>(
      `SELECT "username","role" FROM "User" ORDER BY "id"`,
    );
    expect(rolesBefore.map((r) => r.role)).toEqual(["admin", "participant", "participant", "participant"]);

    // ── run the real migration file, verbatim ────────────────────────────
    // `DatabaseSync.exec` runs a multi-statement script exactly as the Prisma
    // CLI would, so the migration is exercised as written — no hand-split
    // statements that could mask a broken file.
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
    };
    const raw = new DatabaseSync(migDb);
    raw.exec(fs.readFileSync(MIGRATION, "utf8"));
    raw.close();

    // ── conversion ───────────────────────────────────────────────────────
    const rolesAfter = await migClient.$queryRawUnsafe<Array<{ username: string; role: string }>>(
      `SELECT "username","role" FROM "User" ORDER BY "id"`,
    );
    expect(rolesAfter).toEqual([
      { username: "mig-admin", role: "admin" },
      { username: "mig-bea", role: "examiner" },
      { username: "mig-carla", role: "examiner" },
      { username: "mig-dora", role: "examiner" },
    ]);
    expect(await migClient.user.count({ where: { role: "participant" } })).toBe(0);

    // ── preservation ─────────────────────────────────────────────────────
    const usersAfter = await migClient.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id","username","passwordHash","active","disabledAt" FROM "User" ORDER BY "id"`,
    );
    expect(usersAfter).toEqual(usersBefore);
    // The deactivated account stays deactivated; the others stay active.
    expect(await migClient.user.count({ where: { active: false } })).toBe(1);
    expect(await migClient.$queryRawUnsafe(`SELECT * FROM "Session"`)).toEqual(sessionsBefore);
    expect(await migClient.$queryRawUnsafe(`SELECT * FROM "OralExam"`)).toEqual(examsBefore);
    expect(await migClient.$queryRawUnsafe(`SELECT * FROM "OralExamQuestion"`)).toEqual(itemsBefore);
    expect(await migClient.oralQuestion.count()).toBe(poolBefore);
    expect(await migClient.oralTheme.count()).toBe(themesBefore);

    // The exam still belongs to its (now examiner) owner and keeps its score.
    const exam = await migClient.oralExam.findUnique({ where: { id: "m-exam" } });
    expect(exam!.userId).toBe("m-bea");
    expect(exam!.totalPoints).toBe(80);
    expect(exam!.result).toBe("Bestanden");
  });

  it("makes examiner the default role for new rows", async () => {
    const created = await migClient.user.create({
      data: { username: "mig-new", passwordHash: "scrypt$NEW" },
      select: { role: true },
    });
    expect(created.role).toBe("examiner");
  });
});

describe("examiner management by the admin", () => {
  let examinerId: string;
  let examinerCookie: string | null;

  it("creates an examiner account", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "pruefer1",
        password: EXAMINER_PW,
        role: "examiner",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    examinerId = body.user.id;
    expect(body.user.role).toBe("examiner");
    expect(body.user.active).toBe(true);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("lists users without any hash", async () => {
    const res = await app.request("/api/users", { headers: adminToken() });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("pruefer1");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("scrypt$");
  });

  it("rejects a duplicate username with 400", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pruefer1", password: EXAMINER_PW, role: "examiner" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a short password with 400", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "kurzpw", password: "abc", role: "examiner" }),
    });
    expect(res.status).toBe(400);
  });

  it("defaults to the examiner role when the role is absent or bogus", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ohnerolle", password: EXAMINER_PW, role: "superadmin" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe("examiner");
  });

  it("refuses to create a participant (retired role) and creates an examiner instead", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "altteilnehmer", password: EXAMINER_PW, role: "participant" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).user.role).toBe("examiner");
    const row = await client.user.findUnique({ where: { username: "altteilnehmer" } });
    expect(row!.role).toBe("examiner");
  });

  it("refuses to PATCH a user back to the retired participant role", async () => {
    const res = await app.request(`/api/users/${examinerId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "participant" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid role/i);
    const row = await client.user.findUnique({ where: { id: examinerId } });
    expect(row!.role).toBe("examiner");
  });

  it("examiner can log in", async () => {
    const { res, cookie, body } = await login("pruefer1", EXAMINER_PW);
    expect(res.status).toBe(200);
    expect(body.user.role).toBe("examiner");
    examinerCookie = cookie;
  });

  it("admin can reset an examiner password, and the old one stops working", async () => {
    const newPw = "ganz-neues-passwort-789";
    const res = await app.request(`/api/users/${examinerId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPw }),
    });
    expect(res.status).toBe(200);
    expect((await login("pruefer1", newPw)).res.status).toBe(200);
    expect((await login("pruefer1", EXAMINER_PW)).res.status).toBe(401);
  });

  it("deactivating an examiner revokes their live session immediately", async () => {
    // fresh session, then deactivate
    const { cookie } = await login("pruefer1", "ganz-neues-passwort-789");
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(200);

    const off = await app.request(`/api/users/${examinerId}`, {
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

  it("a deactivated examiner cannot log in", async () => {
    const { res } = await login("teilnehmer1", "ganz-neues-passwort-789");
    expect(res.status).toBe(401);
  });

  it("reactivating restores login and keeps the account row", async () => {
    const on = await app.request(`/api/users/${examinerId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    expect(on.status).toBe(200);
    const { res, cookie } = await login("pruefer1", "ganz-neues-passwort-789");
    expect(res.status).toBe(200);
    examinerCookie = cookie;
  });

  it("DELETE deactivates (soft) instead of destroying the row", async () => {
    const res = await app.request(`/api/users/${examinerId}`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.active).toBe(false);
    const row = await client.user.findUnique({ where: { id: examinerId } });
    expect(row).toBeTruthy(); // still present, just deactivated
  });

  it("only admins may manage users (examiner → 403, anonymous → 401)", async () => {
    await app.request(`/api/users/${examinerId}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const { cookie } = await login("pruefer1", "ganz-neues-passwort-789");
    const forbidden = await asUser(cookie, "/api/users");
    expect(forbidden.status).toBe(403);
    const anonymous = await app.request("/api/users");
    expect(anonymous.status).toBe(401);
  });

  it("an examiner cannot escalate its own role", async () => {
    const { cookie } = await login("pruefer1", "ganz-neues-passwort-789");
    const res = await asUser(cookie, `/api/users/${examinerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
    const row = await client.user.findUnique({ where: { id: examinerId } });
    expect(row!.role).toBe("examiner");
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

  it("cannot be demoted to examiner", async () => {
    const admin = await client.user.findUnique({ where: { username: "admin" } });
    const res = await app.request(`/api/users/${admin!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "examiner" }),
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
  let examinerCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    const admin = await login("admin", ADMIN_PW);
    adminCookie = admin.cookie!;
    // Make sure the examiner is active and has a known password.
    const p = await client.user.findUnique({ where: { username: "pruefer1" } });
    await app.request(`/api/users/${p!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: true, password: "pruefer-final-999" }),
    });
    examinerCookie = (await login("pruefer1", "pruefer-final-999")).cookie!;
  });

  // Areas an examiner must never reach: user management, the question pool, the
  // case examples and the raw sheet/import surfaces. Enforced server-side, so a
  // hand-crafted request is rejected exactly like a hidden UI link.
  const ADMIN_ONLY = [
    "/api/questions", // /fragen
    "/api/questions/x",
    "/api/case-examples", // /fallbeispiele
    "/api/sheets",
    "/api/import/status",
    "/api/import/runs",
    "/api/users",
  ];

  for (const path of ADMIN_ONLY) {
    it(`blocks examiner access to ${path} (403)`, async () => {
      expect((await asUser(examinerCookie, path)).status).toBe(403);
    });
    it(`blocks anonymous access to ${path} (401)`, async () => {
      expect((await app.request(path)).status).toBe(401);
    });
  }

  // The IHK read endpoints back the start page `/` and the detail pages
  // `/ihk/:id`, both inside the examiner's area. This database has no import
  // run, so a successful call answers 503 "no data available yet" — what
  // matters is that the gate does NOT answer 401/403.
  it("does not gate the examiner out of the start-page IHK list", async () => {
    const res = await asUser(examinerCookie, "/api/ihk?limit=5");
    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("does not gate the examiner out of IHK search", async () => {
    expect((await asUser(examinerCookie, "/api/ihk/search?q=aach")).status).toBe(503);
  });

  it("does not gate the examiner out of the public API root", async () => {
    expect((await asUser(examinerCookie, "/api")).status).toBe(200);
  });

  it("lets the examiner reach the IHK detail endpoint (one of their pages)", async () => {
    // 503 = handler reached (no imported data), not 401/403.
    const res = await asUser(examinerCookie, "/api/ihk/anything");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // The oral simulation is the shared staff working area.
  it("lets the examiner create an exam", async () => {
    const res = await asUser(examinerCookie, "/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Prüfer erstellt" }),
    });
    expect(res.status).toBe(201);
  });

  it("lets the examiner rate a question", async () => {
    const created = await asUser(examinerCookie, "/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Prüfer bewertet" }),
    });
    const { examId } = await created.json();
    const res = await asUser(examinerCookie, `/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "richtig" }),
    });
    expect(res.status).toBe(200);
  });

  it("lets the examiner delete an exam", async () => {
    const created = await asUser(examinerCookie, "/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Prüfer löscht" }),
    });
    const { examId } = await created.json();
    const res = await asUser(examinerCookie, `/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  // Seeding rewrites the shared pool, so it stays admin-only.
  it("does NOT let the examiner seed the pool (403)", async () => {
    expect((await asUser(examinerCookie, "/api/oral/seed", { method: "POST" })).status).toBe(403);
  });

  it("still lets the admin seed the pool", async () => {
    expect((await asUser(adminCookie, "/api/oral/seed", { method: "POST" })).status).toBe(200);
  });
});

describe("staff-wide exam visibility", () => {
  // Both roles administer the same exam pool: no per-user scoping. An exam
  // created by one examiner is visible and editable to another, and to admins.
  let examinerACookie: string;
  let examinerBCookie: string;
  let adminCookie: string;
  let examId: string;
  let otherExamId: string;

  beforeAll(async () => {
    adminCookie = (await login("admin", ADMIN_PW)).cookie!;
    examinerACookie = (await login("pruefer1", "pruefer-final-999")).cookie!;

    // A second examiner account.
    await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pruefer2", password: "pruefer2-passwort-123", role: "examiner" }),
    });
    examinerBCookie = (await login("pruefer2", "pruefer2-passwort-123")).cookie!;

    const a = await createExam(client, { candidateName: "Prüfung A" }, mulberry32(4242));
    examId = a.examId;
    const b = await createExam(client, { candidateName: "Prüfung B" }, mulberry32(777));
    otherExamId = b.examId;
  });

  it("the list is the same for both examiners (no per-user scoping)", async () => {
    const asA = await asUser(examinerACookie, "/api/oral/exams?limit=50");
    const asB = await asUser(examinerBCookie, "/api/oral/exams?limit=50");
    expect(asA.status).toBe(200);
    expect(asB.status).toBe(200);
    const idsA = (await asA.json()).data.map((e: { id: string }) => e.id);
    const idsB = (await asB.json()).data.map((e: { id: string }) => e.id);
    expect(idsA).toEqual(idsB);
    expect(idsA).toContain(examId);
    expect(idsA).toContain(otherExamId);
  });

  it("an examiner can read an exam created by another examiner", async () => {
    const res = await asUser(examinerBCookie, `/api/oral/exams/${examId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).candidate.name).toBe("Prüfung A");
  });

  it("an examiner can read another examiner's score", async () => {
    expect((await asUser(examinerBCookie, `/api/oral/exams/${examId}/score`)).status).toBe(200);
  });

  it("an examiner can rate an exam created by another examiner", async () => {
    const res = await asUser(examinerBCookie, `/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "teilweise richtig" }),
    });
    expect(res.status).toBe(200);
  });

  it("an unknown exam id is still a 404 for an examiner", async () => {
    expect((await asUser(examinerBCookie, "/api/oral/exams/does-not-exist")).status).toBe(404);
  });

  it("exam creation records the caller for audit only (never as an access key)", async () => {
    // The creator id is stored, but it does not restrict who may read it.
    const me = await asUser(examinerACookie, "/api/auth/me");
    const { user } = await me.json();
    const created = await asUser(examinerACookie, "/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "Audit Prüfung" }),
    });
    const { examId: id } = await created.json();
    const row = await client.oralExam.findUnique({ where: { id } });
    expect(row!.userId).toBe(user.id);
    // … and the other examiner can still read it.
    expect((await asUser(examinerBCookie, `/api/oral/exams/${id}`)).status).toBe(200);
  });

  it("ownership cannot be spoofed through the request body", async () => {
    // An admin creating an exam while passing userId is recorded as the
    // identity-derived creator (null for the legacy token), not the body value.
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
    const p = await client.user.findUnique({ where: { username: "pruefer1" } });
    const { cookie } = await login("pruefer1", "pruefer-final-999");
    expect((await asUser(cookie, "/api/auth/me")).status).toBe(200);

    await app.request(`/api/users/${p!.id}`, {
      method: "PATCH",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pruefer-final-999" }),
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
