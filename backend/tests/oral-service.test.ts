// Service-level integration tests: exam creation, persistence, rating, scoring,
// and the oral API routes (incl. auth). Uses an isolated SQLite DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool, ensureOralPoolSeeded } from "../src/oral/seed";
import { createExam, rateQuestion, completeExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM, ORAL_UVV_THEME, ORAL_TOTAL_WEIGHT } from "../src/oral/themes";
import { createApp } from "../src/api/app";
import { makeRequester } from "./helpers/request";

const TEST_TOKEN = "oral-test-token-do-not-use-in-prod-0123456789abcdef";
const SEED_QUESTION_COUNT = 377; // 342 + 35 (27 UmW + 8 StGB, imported 2026)

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;
let req: (path: string, init?: RequestInit) => Promise<Response>;

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
  req = makeRequester(app, TEST_TOKEN);
});

afterAll(async () => {
  await disconnectPrisma();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" };
}

type Item = { orderKey: number; weight: number; themeName: string; questionId: string; points: number; rating: string | null };

async function loadItems(examId: string): Promise<Item[]> {
  return client.oralExamQuestion.findMany({
    where: { examId },
    orderBy: { orderKey: "asc" },
    select: { orderKey: true, weight: true, themeName: true, questionId: true, points: true, rating: true },
  });
}

describe("oral service — persistence & scoring", () => {
  let examId: string;

  it("creates an exam with a persisted 13-question set", async () => {
    const res = await createExam(client, { candidateName: "Max Mustermann", examiner: "Prüfer A" }, mulberry32(123));
    examId = res.examId;
    expect(examId).toBeTruthy();

    const items = await loadItems(examId);
    expect(items.length).toBe(ORAL_QUESTIONS_PER_EXAM);
    expect(items.length).toBe(13);
    // orderKeys are a contiguous 1..13
    expect(items.map((i) => i.orderKey)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    // first 9 slots follow the theme order
    expect(items.slice(0, 9).map((i) => i.themeName)).toEqual(ORAL_THEMES.map((t) => t.name));
    // all 9 Themenbereiche present, exactly one UVV question
    expect(new Set(items.map((i) => i.themeName)).size).toBe(9);
    expect(items.filter((i) => i.themeName === ORAL_UVV_THEME).length).toBe(1);
    // no duplicates, all questions exist in pool
    expect(new Set(items.map((i) => i.questionId)).size).toBe(13);
    for (const it of items) {
      expect(await client.oralQuestion.findUnique({ where: { id: it.questionId } })).toBeTruthy();
    }
  });

  it("per-question weights sum to 100 and split for doubled themes", async () => {
    const items = await loadItems(examId);
    expect(items.reduce((a, i) => a + i.weight, 0)).toBe(ORAL_TOTAL_WEIGHT);
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.themeName, (counts.get(i.themeName) ?? 0) + 1);
    for (const i of items) {
      const theme = ORAL_THEMES.find((t) => t.name === i.themeName)!;
      expect(i.weight, i.themeName).toBe(theme.weight / (counts.get(i.themeName) ?? 1));
      expect(Number.isInteger(i.weight)).toBe(true);
    }
  });

  it("recomputes 0 points initially (all unrated)", async () => {
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(0);
    expect(exam!.percent).toBe(0);
    expect(exam!.result).toBe("Nicht bestanden");
    expect(exam!.maxPoints).toBe(100);
  });

  it("rating a single question adds exactly its weight (richtig)", async () => {
    const items = await loadItems(examId);
    const target = items[0]; // orderKey 1
    await rateQuestion(client, examId, target.orderKey, { rating: "richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(target.weight);
    const item = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: target.orderKey } });
    expect(item!.points).toBe(target.weight);
    expect(item!.rating).toBe("richtig");
  });

  it("rating all 13 richtig → 100 points, Bestanden", async () => {
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(100);
    expect(exam!.percent).toBe(100);
    expect(exam!.result).toBe("Bestanden");
  });

  it("rating all teilweise richtig → exactly 50 points, Bestanden (threshold)", async () => {
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "teilweise richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBe(50);
    expect(exam!.percent).toBe(50);
    expect(exam!.result).toBe("Bestanden");
    // every per-question score is an exact integer half
    for (const it of items) {
      const cur = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: it.orderKey } });
      expect(Number.isInteger(cur!.points)).toBe(true);
      expect(cur!.points).toBe(it.weight / 2);
    }
  });

  it("one point below the threshold → Nicht bestanden", async () => {
    // all falsch first
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "falsch" });
    // pick questions totalling exactly 49 via "teilweise richtig"
    let acc = 0;
    for (const it of items) {
      if (acc + it.weight / 2 <= 49) {
        await rateQuestion(client, examId, it.orderKey, { rating: "teilweise richtig" });
        acc += it.weight / 2;
      }
    }
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.totalPoints).toBeLessThan(50);
    expect(exam!.result).toBe("Nicht bestanden");
  });

  it("notes are persisted", async () => {
    await rateQuestion(client, examId, 1, { note: "Antwort unvollständig" });
    const item = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: 1 } });
    expect(item!.note).toBe("Antwort unvollständig");
  });

  it("completing the exam sets status + completedAt and freezes the score", async () => {
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "richtig" });
    await completeExam(client, examId);
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.status).toBe("completed");
    expect(exam!.completedAt).toBeTruthy();
    expect(exam!.totalPoints).toBe(100);
  });

  it("reopening (re-fetching) keeps the SAME questions — never regenerated", async () => {
    const before = await loadItems(examId);
    const after = await loadItems(examId);
    expect(after.map((a) => a.questionId)).toEqual(before.map((b) => b.questionId));
  });

  it("a second candidate gets a different (but structurally equal) question set", async () => {
    const res2 = await createExam(client, { candidateName: "Anna Muster" }, mulberry32(999));
    const items2 = await loadItems(res2.examId);
    const items1 = await loadItems(examId);
    expect(items2.length).toBe(13);
    expect(items2.map((i) => i.orderKey)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    const ids1 = items1.map((i) => i.questionId).sort();
    const ids2 = items2.map((i) => i.questionId).sort();
    expect(JSON.stringify(ids1)).not.toEqual(JSON.stringify(ids2));
  });
});

describe("oral API routes", () => {
  let examId: string;

  it("GET /api/oral/themes requires auth and returns 9 themes", async () => {
    expect((await app.request("/api/oral/themes")).status).toBe(401);
    const res = await req("/api/oral/themes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(9);
    expect(body.data.map((t: { name: string }) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
  });

  it(`GET /api/oral/pool requires auth and returns ${SEED_QUESTION_COUNT} questions`, async () => {
    expect((await app.request("/api/oral/pool?limit=400")).status).toBe(401);
    const res = await req("/api/oral/pool?limit=400");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(SEED_QUESTION_COUNT);
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
    const res = await req("/api/oral/exams", {
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
    const res = await req("/api/oral/exams?limit=50");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((e: { id: string }) => e.id === examId)).toBe(true);
  });

  it("GET /api/oral/exams/:id returns the exam with 13 questions", async () => {
    const res = await req(`/api/oral/exams/${examId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(13);
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

  it("PATCH all 13 questions richtig → 100 points, Bestanden", async () => {
    for (let order = 1; order <= ORAL_QUESTIONS_PER_EXAM; order++) {
      const res = await req(`/api/oral/exams/${examId}/questions/${order}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ rating: "richtig" }),
      });
      expect(res.status).toBe(200);
    }
    const score = await req(`/api/oral/exams/${examId}/score`);
    const body = await score.json();
    expect(body.totalPoints).toBe(100);
    expect(body.percent).toBe(100);
    expect(body.result).toBe("Bestanden");
  });

  it("PATCH question order 14 → 400 (only 13 questions exist)", async () => {
    const res = await req(`/api/oral/exams/${examId}/questions/14`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ rating: "richtig" }),
    });
    expect(res.status).toBe(400);
  });

  it("invalid rating → 400", async () => {
    const res = await req(`/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ rating: "super" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST complete finalizes the exam", async () => {
    const res = await req(`/api/oral/exams/${examId}/complete`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const exam = await req(`/api/oral/exams/${examId}`);
    const body = await exam.json();
    expect(body.status).toBe("completed");
    expect(body.percent).toBe(100);
  });
});

describe("historical exams are immutable across pool changes", () => {
  it("re-seeding the pool never alters an existing exam or its items", async () => {
    // Create an exam, rate some questions, snapshot everything.
    const created = await createExam(client, { candidateName: "Historisch" }, mulberry32(555));
    const items = await loadItems(created.examId);
    await rateQuestion(client, created.examId, items[0].orderKey, { rating: "richtig" });
    await rateQuestion(client, created.examId, items[1].orderKey, { rating: "teilweise richtig" });

    const examBefore = await client.oralExam.findUnique({
      where: { id: created.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });

    // Re-run the seeder (idempotent) — must not touch the exam.
    await seedOralPool(client);
    await ensureOralPoolSeeded(client);

    const examAfter = await client.oralExam.findUnique({
      where: { id: created.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(JSON.stringify(examAfter)).toEqual(JSON.stringify(examBefore));
  });

  it("a legacy 8-question exam keeps its stored weights (snapshots, not theme)", async () => {
    // Simulate a pre-extension exam: 8 items with the OLD weights, created
    // directly in the DB (as an old deployment would have stored it).
    const legacyWeights = [10, 12, 14, 14, 8, 18, 8, 16];
    const cand = await client.oralCandidate.create({ data: { name: `Legacy ${Date.now()}` } });
    const pool = await client.oralQuestion.findMany({ take: 8 });
    const exam = await client.oralExam.create({
      data: {
        candidateId: cand.id,
        status: "draft",
        maxPoints: 100,
        totalPoints: 0,
        percent: 0,
        result: "Nicht bestanden",
        items: {
          create: pool.map((q, i) => ({
            questionId: q.id,
            orderKey: i + 1,
            themeName: ORAL_THEMES[i]?.name ?? q.themeId,
            weight: legacyWeights[i],
            rating: null,
            points: 0,
          })),
        },
      },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(exam.items.map((i) => i.weight)).toEqual(legacyWeights);

    // Rate the 18-point question: it must award 18, not the new 16.
    await rateQuestion(client, exam.id, 6, { rating: "richtig" });
    const after = await client.oralExam.findUnique({
      where: { id: exam.id },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(after!.items.find((i) => i.orderKey === 6)!.weight).toBe(18);
    expect(after!.items.find((i) => i.orderKey === 6)!.points).toBe(18);
    expect(after!.totalPoints).toBe(18);
    // maxPoints still 100 (legacy total), pass threshold unchanged
    expect(after!.maxPoints).toBe(100);
  });
});

describe("ensureOralPoolSeeded — startup self-bootstrap", () => {
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
      expect(await client.oralQuestion.findUnique({ where: { id: it.questionId } })).toBeTruthy();
    }
  });

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
      expect(await fresh.oralQuestion.count()).toBe(0);

      const res = await ensureOralPoolSeeded(fresh);
      expect(res.seeded).toBe(true);
      expect(res.themes).toBe(ORAL_THEMES.length);
      expect(res.themes).toBe(9);
      expect(res.questions).toBe(SEED_QUESTION_COUNT);

      const themes = await fresh.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
      expect(themes.map((t) => t.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
      expect(themes.map((t) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
      for (const t of themes) {
        expect(await fresh.oralQuestion.count({ where: { themeId: t.id } })).toBeGreaterThan(0);
      }
      // UVV theme exists with questions
      const uvv = themes.find((t) => t.name === ORAL_UVV_THEME);
      expect(uvv).toBeTruthy();
      expect(await fresh.oralQuestion.count({ where: { themeId: uvv!.id } })).toBeGreaterThan(0);

      // re-run: idempotent — no duplicates, no count growth
      const res2 = await ensureOralPoolSeeded(fresh);
      expect(res2.seeded).toBe(false);
      expect(await fresh.oralQuestion.count()).toBe(SEED_QUESTION_COUNT);
      const all = await fresh.oralQuestion.findMany({ select: { excelId: true } });
      expect(new Set(all.map((q) => q.excelId)).size).toBe(all.length);
    } finally {
      await fresh.$disconnect();
      if (fs.existsSync(freshPath)) fs.unlinkSync(freshPath);
    }
  });
});
