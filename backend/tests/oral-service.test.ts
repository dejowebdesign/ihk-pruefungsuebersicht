// Service-level integration tests: exam creation, persistence, rating, scoring,
// and the oral API routes (incl. auth). Uses an isolated SQLite DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool, ensureOralPoolSeeded } from "../src/oral/seed";
import { createExam, rateQuestion, completeExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { ORAL_THEMES } from "../src/oral/themes";
import { createApp } from "../src/api/app";

const TEST_TOKEN = "oral-test-token-do-not-use-in-prod-0123456789abcdef";

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-oral-test-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.ADMIN_TOKEN = TEST_TOKEN;
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
});

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" };
}

describe("oral service — persistence & scoring", () => {
  let examId: string;

  it("creates an exam with a persisted 8-question set", async () => {
    const res = await createExam(client, { candidateName: "Max Mustermann", examiner: "Prüfer A" }, mulberry32(123));
    examId = res.examId;
    expect(examId).toBeTruthy();

    const exam = await client.oralExam.findUnique({
      where: { id: examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(exam).toBeTruthy();
    expect(exam!.items.length).toBe(8);
    expect(exam!.items.map((i) => i.orderKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(exam!.items.map((i) => i.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
    // no duplicate questions
    expect(new Set(exam!.items.map((i) => i.questionId)).size).toBe(8);
    // all questions exist in pool
    for (const it of exam!.items) {
      const q = await client.oralQuestion.findUnique({ where: { id: it.questionId } });
      expect(q).toBeTruthy();
    }
  });

  it("recomputes 0 points initially (all unrated)", async () => {
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(0);
    expect(exam!.percent).toBe(0);
    expect(exam!.result).toBe("Nicht bestanden");
  });

  it("rating question 6 (weight 18) as richtig → 18 points, 18%, Nicht bestanden", async () => {
    await rateQuestion(client, examId, 6, { rating: "richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(18);
    expect(exam!.percent).toBe(18);
    expect(exam!.result).toBe("Nicht bestanden");
    const item = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: 6 } });
    expect(item!.points).toBe(18);
    expect(item!.rating).toBe("richtig");
  });

  it("rating more questions → recompute to 55 (Bestanden)", async () => {
    // theme1(10) richtig, theme2(12) teilweise=6, theme3(14) richtig, theme4(14) teilweise=7, theme6 already 18
    // total = 10+6+14+7+18 = 55
    await rateQuestion(client, examId, 1, { rating: "richtig" });
    await rateQuestion(client, examId, 2, { rating: "teilweise richtig" });
    await rateQuestion(client, examId, 3, { rating: "richtig" });
    await rateQuestion(client, examId, 4, { rating: "teilweise richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(55);
    expect(exam!.percent).toBe(55);
    expect(exam!.result).toBe("Bestanden");
  });

  it("notes are persisted", async () => {
    await rateQuestion(client, examId, 1, { note: "Antwort unvollständig" });
    const item = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: 1 } });
    expect(item!.note).toBe("Antwort unvollständig");
  });

  it("completing the exam sets status + completedAt", async () => {
    await completeExam(client, examId);
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.status).toBe("completed");
    expect(exam!.completedAt).toBeTruthy();
    expect(exam!.totalPoints).toBe(55);
  });

  it("reopening (rating again) keeps the SAME questions — never regenerated", async () => {
    const before = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
      select: { questionId: true, orderKey: true },
    });
    // simulate "reload": just re-fetch; ids must be stable
    const after = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
      select: { questionId: true, orderKey: true },
    });
    expect(after.map((a) => a.questionId)).toEqual(before.map((b) => b.questionId));
  });

  it("a second candidate gets a different (but structurally equal) question set", async () => {
    const res2 = await createExam(client, { candidateName: "Anna Muster" }, mulberry32(999));
    const exam2 = await client.oralExam.findUnique({
      where: { id: res2.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    const exam1 = await client.oralExam.findUnique({
      where: { id: examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(exam2!.items.length).toBe(8);
    expect(exam2!.items.map((i) => i.orderKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // different selections (with 218 questions, near-certain)
    const ids1 = exam1!.items.map((i) => i.questionId).sort();
    const ids2 = exam2!.items.map((i) => i.questionId).sort();
    expect(JSON.stringify(ids1)).not.toEqual(JSON.stringify(ids2));
  });
});

describe("oral API routes", () => {
  let examId: string;

  it("GET /api/oral/themes is public and returns 8 themes", async () => {
    const res = await app.request("/api/oral/themes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(8);
  });

  it("GET /api/oral/pool is public and returns 218 questions", async () => {
    const res = await app.request("/api/oral/pool?limit=300");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(218);
  });

  it("POST /api/oral/exams without auth → 401", async () => {
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: "X" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/oral/exams with auth creates an exam", async () => {
    const res = await app.request("/api/oral/exams", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ candidateName: "API Prüfling", examiner: "Prüfer API" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    examId = body.examId;
    expect(examId).toBeTruthy();
  });

  it("GET /api/oral/exams lists the created exam", async () => {
    const res = await app.request("/api/oral/exams?limit=50");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((e: { id: string }) => e.id === examId)).toBe(true);
  });

  it("GET /api/oral/exams/:id returns the exam with 8 questions", async () => {
    const res = await app.request(`/api/oral/exams/${examId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(8);
    expect(body.candidate.name).toBe("API Prüfling");
  });

  it("PATCH question without auth → 401", async () => {
    const res = await app.request(`/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "richtig" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH question with auth rates and recomputes", async () => {
    // rate all richtig → 100
    for (const t of ORAL_THEMES) {
      const res = await app.request(`/api/oral/exams/${examId}/questions/${t.orderKey}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ rating: "richtig" }),
      });
      expect(res.status).toBe(200);
    }
    const score = await app.request(`/api/oral/exams/${examId}/score`);
    const body = await score.json();
    expect(body.totalPoints).toBe(100);
    expect(body.percent).toBe(100);
    expect(body.result).toBe("Bestanden");
  });

  it("invalid rating → 400", async () => {
    const res = await app.request(`/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ rating: "super" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST complete finalizes the exam", async () => {
    const res = await app.request(`/api/oral/exams/${examId}/complete`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const exam = await app.request(`/api/oral/exams/${examId}`);
    const body = await exam.json();
    expect(body.status).toBe("completed");
    expect(body.percent).toBe(100);
  });
});

describe("ensureOralPoolSeeded — startup self-bootstrap", () => {
  // The already-seeded `client` has the full pool (beforeAll ran seedOralPool).
  // A second call must be a no-op: report seeded=false and not change counts.
  it("is a no-op when the pool is already full (idempotent restart)", async () => {
    const before = { t: await client.oralTheme.count(), q: await client.oralQuestion.count() };
    const res = await ensureOralPoolSeeded(client);
    const after = { t: await client.oralTheme.count(), q: await client.oralQuestion.count() };
    expect(res.seeded).toBe(false);
    expect(after.t).toBe(before.t);
    expect(after.q).toBe(before.q);
    // every exam referenced question still resolves (no row replaced/removed)
    const exams = await client.oralExamQuestion.findMany({ select: { questionId: true } });
    for (const it of exams) {
      const q = await client.oralQuestion.findUnique({ where: { id: it.questionId } });
      expect(q).toBeTruthy();
    }
  });

  // A fresh, empty DB must be seeded to exactly the seed count, no duplicates.
  it("seeds an empty pool on a fresh deploy (no manual command)", async () => {
    const freshPath = path.join(os.tmpdir(), `ihk-oral-bootstrap-${Date.now()}.db`);
    if (fs.existsSync(freshPath)) fs.unlinkSync(freshPath);
    const env = { ...process.env, DATABASE_URL: `file:${freshPath}` };
    execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "ignore",
      env,
    });
    const fresh = new PrismaClient({ datasources: { db: { url: `file:${freshPath}` } } });
    try {
      // schema created, but zero oral questions — mirrors a fresh Docker volume
      expect(await fresh.oralQuestion.count()).toBe(0);

      const res = await ensureOralPoolSeeded(fresh);
      expect(res.seeded).toBe(true);
      expect(res.themes).toBe(ORAL_THEMES.length);
      expect(res.questions).toBe(218);

      // 8 themes, exact weights/order preserved, one question per theme present
      const themes = await fresh.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
      expect(themes.map((t) => t.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
      expect(themes.map((t) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
      for (const t of themes) {
        expect(await fresh.oralQuestion.count({ where: { themeId: t.id } })).toBeGreaterThan(0);
      }

      // re-run: idempotent — no duplicates, no count growth
      const res2 = await ensureOralPoolSeeded(fresh);
      expect(res2.seeded).toBe(false);
      expect(await fresh.oralQuestion.count()).toBe(218);
      // excelId uniqueness preserved (no duplicate rows)
      const all = await fresh.oralQuestion.findMany({ select: { excelId: true } });
      expect(new Set(all.map((q) => q.excelId)).size).toBe(all.length);
    } finally {
      await fresh.$disconnect();
      if (fs.existsSync(freshPath)) fs.unlinkSync(freshPath);
    }
  });
});
