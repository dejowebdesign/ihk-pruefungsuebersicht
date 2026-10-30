// Service-level integration tests: exam creation, persistence, rating, the
// weighted PERCENTAGE scoring (Phase 11), the persisted rotation, the oral API
// routes, and the immutability of historical exams. Uses an isolated SQLite DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool, ensureOralPoolSeeded } from "../src/oral/seed";
import {
  createExam,
  rateQuestion,
  completeExam,
  SCORING_VERSION_PERCENT,
} from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import {
  ORAL_THEMES,
  ORAL_QUESTIONS_PER_EXAM,
  ORAL_MAIN_THEME_NAMES,
  ORAL_OTHER_THEME_NAMES,
  ORAL_ROTATION_THEMES,
} from "../src/oral/themes";
import { readRotation } from "../src/oral/rotation";
import { createApp } from "../src/api/app";
import { makeRequester } from "./helpers/request";

const TEST_TOKEN = "oral-test-token-do-not-use-in-prod-0123456789abcdef";
// 377 (Phase 10) + 54 new provided questions = 431. One provided question was
// an exact duplicate of UmM-23 and was NOT imported a second time.
const SEED_QUESTION_COUNT = 431;

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;
let req: (path: string, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-oral-test-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  // connection_limit=1 serialises writers in the Prisma pool, so concurrent
  // exam starts queue (honouring maxWait) instead of colliding on SQLite's
  // single write lock and surfacing as a spurious timeout.
  process.env.DATABASE_URL = `file:${dbPath}?connection_limit=1`;
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

type Item = {
  orderKey: number;
  weight: number;
  themeName: string;
  questionId: string;
  points: number;
  rating: string | null;
};

async function loadItems(examId: string): Promise<Item[]> {
  return client.oralExamQuestion.findMany({
    where: { examId },
    orderBy: { orderKey: "asc" },
    select: {
      orderKey: true,
      weight: true,
      themeName: true,
      questionId: true,
      points: true,
      rating: true,
    },
  });
}

async function scoreOf(examId: string) {
  const e = await client.oralExam.findUnique({ where: { id: examId } });
  return e!;
}

describe("exam creation — the 13-question distribution", () => {
  let examId: string;

  it("creates an exam with a persisted 13-question set", async () => {
    const res = await createExam(
      client,
      { candidateName: "Max Mustermann", examiner: "Pruefer A" },
      mulberry32(123),
    );
    examId = res.examId;
    const items = await loadItems(examId);
    expect(items.length).toBe(ORAL_QUESTIONS_PER_EXAM);
    expect(items.map((i) => i.orderKey)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(new Set(items.map((i) => i.questionId)).size).toBe(13);
    for (const it of items) {
      expect(await client.oralQuestion.findUnique({ where: { id: it.questionId } })).toBeTruthy();
    }
  });

  it("draws exactly 2 questions from each of the 4 main themes", async () => {
    const items = await loadItems(examId);
    for (const name of ORAL_MAIN_THEME_NAMES) {
      expect(items.filter((i) => i.themeName === name)).toHaveLength(2);
    }
  });

  it("draws at least 1 question from each of the 4 other themes", async () => {
    const items = await loadItems(examId);
    for (const name of ORAL_OTHER_THEME_NAMES) {
      expect(items.filter((i) => i.themeName === name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("covers all 8 themes and never exceeds 2 per theme", async () => {
    const items = await loadItems(examId);
    expect(new Set(items.map((i) => i.themeName)).size).toBe(8);
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.themeName, (counts.get(i.themeName) ?? 0) + 1);
    for (const [, c] of counts) expect(c).toBeLessThanOrEqual(2);
  });

  it("snapshots the THEME weight on every item", async () => {
    const items = await loadItems(examId);
    for (const i of items) {
      const def = ORAL_THEMES.find((t) => t.name === i.themeName)!;
      expect(i.weight).toBe(def.weight);
    }
  });

  it("marks the exam as the percentage scoring version", async () => {
    expect((await scoreOf(examId)).scoringVersion).toBe(SCORING_VERSION_PERCENT);
  });
});

describe("weighted percentage scoring end to end", () => {
  let examId: string;

  beforeAll(async () => {
    examId = (await createExam(client, { candidateName: "Score Pruefling" }, mulberry32(7))).examId;
  });

  it("starts at 0 % and Nicht bestanden", async () => {
    const e = await scoreOf(examId);
    expect(e.percent).toBe(0);
    expect(e.result).toBe("Nicht bestanden");
  });

  it("all 13 richtig → exactly 100 %", async () => {
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "richtig" });
    const e = await scoreOf(examId);
    expect(e.percent).toBe(100);
    expect(e.result).toBe("Bestanden");
  });

  it("all 13 teilweise richtig → exactly 50 % (threshold, still passes)", async () => {
    const items = await loadItems(examId);
    for (const it of items)
      await rateQuestion(client, examId, it.orderKey, { rating: "teilweise richtig" });
    const e = await scoreOf(examId);
    expect(e.percent).toBe(50);
    expect(e.result).toBe("Bestanden");
  });

  it("all 13 falsch → 0 % and Nicht bestanden", async () => {
    const items = await loadItems(examId);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "falsch" });
    const e = await scoreOf(examId);
    expect(e.percent).toBe(0);
    expect(e.result).toBe("Nicht bestanden");
  });

  it("only BGB fully correct → exactly 18 %", async () => {
    const items = await loadItems(examId);
    for (const it of items) {
      const correct = it.themeName === ORAL_MAIN_THEME_NAMES[0];
      await rateQuestion(client, examId, it.orderKey, { rating: correct ? "richtig" : "falsch" });
    }
    expect((await scoreOf(examId)).percent).toBe(18);
  });

  it("only RdOesO incl. Gewerberecht fully correct → exactly 10 %", async () => {
    const items = await loadItems(examId);
    for (const it of items) {
      const correct = it.themeName === ORAL_MAIN_THEME_NAMES[3];
      await rateQuestion(client, examId, it.orderKey, { rating: correct ? "richtig" : "falsch" });
    }
    expect((await scoreOf(examId)).percent).toBe(10);
  });

  it("half of the two BGB questions → exactly 9 %", async () => {
    const items = await loadItems(examId);
    const bgb = items.filter((i) => i.themeName === ORAL_MAIN_THEME_NAMES[0]);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "falsch" });
    await rateQuestion(client, examId, bgb[0].orderKey, { rating: "richtig" });
    expect((await scoreOf(examId)).percent).toBe(9);
  });

  it("one richtig + one teilweise richtig in BGB → exactly 13.5 %", async () => {
    const items = await loadItems(examId);
    const bgb = items.filter((i) => i.themeName === ORAL_MAIN_THEME_NAMES[0]);
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "falsch" });
    await rateQuestion(client, examId, bgb[0].orderKey, { rating: "richtig" });
    await rateQuestion(client, examId, bgb[1].orderKey, { rating: "teilweise richtig" });
    expect((await scoreOf(examId)).percent).toBe(13.5);
  });

  it("below the threshold → Nicht bestanden", async () => {
    const items = await loadItems(examId);
    const rd = ORAL_MAIN_THEME_NAMES[3];
    const bgb = ORAL_MAIN_THEME_NAMES[0];
    for (const it of items) await rateQuestion(client, examId, it.orderKey, { rating: "falsch" });
    for (const it of items.filter((i) => i.themeName === rd))
      await rateQuestion(client, examId, it.orderKey, { rating: "richtig" });
    const bgbItems = items.filter((i) => i.themeName === bgb);
    await rateQuestion(client, examId, bgbItems[0].orderKey, { rating: "richtig" });
    const e = await scoreOf(examId);
    expect(e.percent).toBe(19); // 10 (RdOesO) + 9 (half of BGB)
    expect(e.result).toBe("Nicht bestanden");
  });

  it("notes are persisted", async () => {
    await rateQuestion(client, examId, 1, { note: "Antwort unvollstaendig" });
    const item = await client.oralExamQuestion.findFirst({ where: { examId, orderKey: 1 } });
    expect(item!.note).toBe("Antwort unvollstaendig");
  });

  it("the legacy points column is never populated for percent exams", async () => {
    const items = await loadItems(examId);
    for (const it of items) expect(it.points).toBe(0);
  });

  it("completing freezes status + completedAt", async () => {
    await completeExam(client, examId);
    const e = await scoreOf(examId);
    expect(e.status).toBe("completed");
    expect(e.completedAt).toBeTruthy();
  });

  it("re-fetching keeps the SAME questions (never regenerated)", async () => {
    const before = await loadItems(examId);
    const after = await loadItems(examId);
    expect(after.map((a) => a.questionId)).toEqual(before.map((b) => b.questionId));
  });
});

describe("persisted rotation of the 13th question", () => {
  it("advances once per created exam and persists in the DB", async () => {
    const start = await readRotation(client);
    await createExam(client, { candidateName: `Rot A ${Date.now()}` }, mulberry32(1));
    expect(await readRotation(client)).toBe(start + 1);
    await createExam(client, { candidateName: `Rot B ${Date.now()}` }, mulberry32(2));
    expect(await readRotation(client)).toBe(start + 2);
  });

  it("cycles the 13th-question theme through all 4 rotation themes", async () => {
    const seen: string[] = [];
    for (let i = 0; i < ORAL_ROTATION_THEMES.length; i++) {
      const before = await readRotation(client);
      const { examId } = await createExam(
        client,
        { candidateName: `RotCycle ${Date.now()} ${i}` },
        mulberry32(100 + i),
      );
      const expected = ORAL_ROTATION_THEMES[before % ORAL_ROTATION_THEMES.length];
      const items = await loadItems(examId);
      const counts = new Map<string, number>();
      for (const it of items) counts.set(it.themeName, (counts.get(it.themeName) ?? 0) + 1);
      // The rotating theme received the extra (2nd) question.
      expect(counts.get(expected)).toBe(2);
      seen.push(expected);
    }
    expect(seen).toEqual([...ORAL_ROTATION_THEMES]);
  });

  it("survives a simulated restart (state is in the DB, not in memory)", async () => {
    const before = await readRotation(client);
    const fresh = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
    try {
      const state = await fresh.oralRotationState.findUnique({ where: { id: "oral-rotation" } });
      expect(state!.counter).toBe(before);
    } finally {
      await fresh.$disconnect();
    }
  });

  it("does not burn a rotation slot when creation fails", async () => {
    const before = await readRotation(client);
    // Emptying a main theme makes drawExam throw inside the transaction.
    const victim = ORAL_MAIN_THEME_NAMES[0];
    const moved = await client.oralQuestion.findMany({
      where: { theme: { name: victim } },
      select: { id: true, themeId: true },
    });
    const other = await client.oralTheme.findFirst({ where: { name: { not: victim } } });
    await client.oralQuestion.updateMany({
      where: { theme: { name: victim } },
      data: { themeId: other!.id },
    });
    try {
      await expect(
        createExam(client, { candidateName: `Fail ${Date.now()}` }, mulberry32(3)),
      ).rejects.toThrow();
      expect(await readRotation(client)).toBe(before);
    } finally {
      for (const q of moved) {
        await client.oralQuestion.update({ where: { id: q.id }, data: { themeId: q.themeId } });
      }
    }
  });

  it("hands out distinct slots under parallel exam starts", async () => {
    const before = await readRotation(client);
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        createExam(client, { candidateName: `Parallel ${Date.now()} ${i}` }, mulberry32(500 + i)),
      ),
    );
    expect(results).toHaveLength(N);
    // Every creation advanced the counter exactly once: no lost update.
    expect(await readRotation(client)).toBe(before + N);
    for (const r of results) {
      const items = await loadItems(r.examId);
      expect(items).toHaveLength(13);
      expect(new Set(items.map((i) => i.questionId)).size).toBe(13);
    }
  });
});

describe("oral API routes", () => {
  let examId: string;

  it("GET /api/oral/themes requires auth and returns 8 themes summing to 100 %", async () => {
    expect((await app.request("/api/oral/themes")).status).toBe(401);
    const res = await req("/api/oral/themes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(8);
    expect(body.data.map((t: { name: string }) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
    expect(body.data.reduce((s: number, t: { weight: number }) => s + t.weight, 0)).toBe(100);
  });

  it(`GET /api/oral/pool requires auth and returns ${SEED_QUESTION_COUNT} questions`, async () => {
    expect((await app.request("/api/oral/pool?limit=500")).status).toBe(401);
    const res = await req("/api/oral/pool?limit=500");
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
      body: JSON.stringify({ candidateName: "API Pruefling", examiner: "Pruefer API" }),
    });
    expect(res.status).toBe(201);
    examId = (await res.json()).examId;
    expect(examId).toBeTruthy();
  });

  it("GET /api/oral/exams lists the created exam", async () => {
    const res = await req("/api/oral/exams?limit=100");
    const body = await res.json();
    expect(body.data.some((e: { id: string }) => e.id === examId)).toBe(true);
  });

  it("GET /api/oral/exams/:id returns 13 questions AND the weighted breakdown", async () => {
    const res = await req(`/api/oral/exams/${examId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(13);
    expect(body.candidate.name).toBe("API Pruefling");
    expect(body.breakdown).toHaveLength(8);
    const sum = body.breakdown.reduce(
      (a: number, b: { contribution: number }) => a + b.contribution,
      0,
    );
    expect(sum).toBe(body.percent);
  });

  it("PATCH question without auth → 401", async () => {
    const res = await app.request(`/api/oral/exams/${examId}/questions/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "richtig" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH all 13 richtig → 100 % and Bestanden, no points in the response", async () => {
    for (let order = 1; order <= ORAL_QUESTIONS_PER_EXAM; order++) {
      const res = await req(`/api/oral/exams/${examId}/questions/${order}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ rating: "richtig" }),
      });
      expect(res.status).toBe(200);
    }
    const body = await (await req(`/api/oral/exams/${examId}/score`)).json();
    expect(body.percent).toBe(100);
    expect(body.result).toBe("Bestanden");
    expect(body.totalPoints).toBeUndefined();
    expect(body.maxPoints).toBeUndefined();
  });

  it("PATCH question order 14 → 400", async () => {
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
    const body = await (await req(`/api/oral/exams/${examId}`)).json();
    expect(body.status).toBe("completed");
    expect(body.percent).toBe(100);
  });
});

describe("historical exams are immutable across pool/theme changes", () => {
  it("re-seeding never alters an existing exam or its items", async () => {
    const created = await createExam(client, { candidateName: "Historisch" }, mulberry32(555));
    const items = await loadItems(created.examId);
    await rateQuestion(client, created.examId, items[0].orderKey, { rating: "richtig" });
    await rateQuestion(client, created.examId, items[1].orderKey, { rating: "teilweise richtig" });

    const before = await client.oralExam.findUnique({
      where: { id: created.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });

    await seedOralPool(client);
    await ensureOralPoolSeeded(client);

    const after = await client.oralExam.findUnique({
      where: { id: created.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(JSON.stringify(after)).toEqual(JSON.stringify(before));
  });

  it("a pre-Phase-11 (points) exam keeps its stored result and legacy scoring", async () => {
    // Simulate a historical exam exactly as the old model stored it:
    // scoringVersion 1, per-question POINT weights, cached points + percent.
    const legacyWeights = [10, 12, 14, 14, 8, 18, 8, 16];
    const cand = await client.oralCandidate.create({ data: { name: `Legacy ${Date.now()}` } });
    const pool = await client.oralQuestion.findMany({ take: 8 });
    const exam = await client.oralExam.create({
      data: {
        candidateId: cand.id,
        status: "draft",
        scoringVersion: 1,
        maxPoints: 100,
        totalPoints: 0,
        percent: 0,
        result: "Nicht bestanden",
        items: {
          create: pool.map((q, i) => ({
            questionId: q.id,
            orderKey: i + 1,
            themeName: "legacy",
            weight: legacyWeights[i],
            rating: null,
            points: 0,
          })),
        },
      },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(exam.items.map((i) => i.weight)).toEqual(legacyWeights);

    // The legacy model awards the full weight as points = percent.
    await rateQuestion(client, exam.id, 6, { rating: "richtig" });
    const after = await scoreOf(exam.id);
    expect(after.totalPoints).toBe(18);
    expect(after.percent).toBe(18);
    expect(after.maxPoints).toBe(100);
    expect(after.scoringVersion).toBe(1);
  });

  it("a historical exam is NOT reinterpreted by the percentage model", async () => {
    // Under the percent model, 2 questions of an 8 % theme both correct = 8 %.
    // The legacy exam must keep its own maths: 8 + 8 points = 16 %.
    const cand = await client.oralCandidate.create({ data: { name: `Legacy2 ${Date.now()}` } });
    const pool = await client.oralQuestion.findMany({ take: 2 });
    const exam = await client.oralExam.create({
      data: {
        candidateId: cand.id,
        status: "completed",
        scoringVersion: 1,
        maxPoints: 100,
        totalPoints: 16,
        percent: 16,
        result: "Nicht bestanden",
        items: {
          create: pool.map((q, i) => ({
            questionId: q.id,
            orderKey: i + 1,
            themeName: "legacy",
            weight: 8,
            rating: "richtig",
            points: 8,
          })),
        },
      },
    });
    await rateQuestion(client, exam.id, 1, { rating: "richtig" });
    const after = await scoreOf(exam.id);
    expect(after.percent).toBe(16);
  });

  it("historical ratings survive the theme merge", async () => {
    // A legacy exam whose item snapshots still carry the OLD theme names
    // (Gewerberecht / RdOesO) must stay readable and scoreable.
    const cand = await client.oralCandidate.create({ data: { name: `Legacy3 ${Date.now()}` } });
    const pool = await client.oralQuestion.findMany({ take: 2 });
    const exam = await client.oralExam.create({
      data: {
        candidateId: cand.id,
        status: "completed",
        scoringVersion: 2,
        maxPoints: 100,
        totalPoints: 0,
        percent: 0,
        result: null,
        items: {
          create: [
            {
              questionId: pool[0].id,
              orderKey: 1,
              themeName: "Gewerberecht / Bewachungsverordnung",
              weight: 10,
              rating: "richtig",
              points: 0,
            },
            {
              questionId: pool[1].id,
              orderKey: 2,
              themeName: "Recht der oeffentlichen Sicherheit und Ordnung",
              weight: 10,
              rating: "richtig",
              points: 0,
            },
          ],
        },
      },
    });
    // Both legacy names normalise to the merged theme, so the two questions
    // form ONE theme of weight 10 -> 2 of 2 correct = 10 %.
    await rateQuestion(client, exam.id, 1, { rating: "richtig" });
    const after = await scoreOf(exam.id);
    expect(after.percent).toBe(10);
  });
});

describe("ensureOralPoolSeeded — startup self-bootstrap", () => {
  it("is a no-op when the pool is already current (idempotent restart)", async () => {
    const before = { t: await client.oralTheme.count(), q: await client.oralQuestion.count() };
    const res = await ensureOralPoolSeeded(client);
    const after = { t: await client.oralTheme.count(), q: await client.oralQuestion.count() };
    expect(res.seeded).toBe(false);
    expect(after.t).toBe(before.t);
    expect(after.q).toBe(before.q);
    const exams = await client.oralExamQuestion.findMany({ select: { questionId: true } });
    for (const it of exams) {
      expect(await client.oralQuestion.findUnique({ where: { id: it.questionId } })).toBeTruthy();
    }
  });

  it("seeds a fresh deploy with 8 themes, the merged theme, and 431 questions", async () => {
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
      expect(res.themes).toBe(8);
      expect(res.questions).toBe(SEED_QUESTION_COUNT);

      const themes = await fresh.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
      expect(themes.map((t) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
      expect(themes.map((t) => t.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
      expect(themes.reduce((s, t) => s + t.weight, 0)).toBe(100);
      expect(await fresh.oralTheme.count()).toBe(8);
      for (const t of themes) {
        expect(await fresh.oralQuestion.count({ where: { themeId: t.id } })).toBeGreaterThan(0);
      }

      // The merged theme holds BOTH the former Gewerberecht and RdOesO content.
      const merged = themes.find((t) => t.name.startsWith("Recht der oeffentlichen"))!;
      const mergedQuestions = await fresh.oralQuestion.findMany({
        where: { themeId: merged.id },
        select: { excelId: true },
      });
      const prefixes = new Set(mergedQuestions.map((q) => q.excelId.split("-")[0]));
      expect(prefixes.has("Gewerberecht")).toBe(true);
      expect(prefixes.has("RdOesO")).toBe(true);

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
