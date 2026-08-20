// Integration tests: PDF evaluation export and exam deletion.
//
// PDF: the rendered PDF must show exactly the stored percent/result and never
// recompute. DELETE: removes the exam + its OralExamQuestion slots, never the
// pool (OralQuestion/OralTheme), 404 for unknown ids, 401 without auth.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createExam, rateQuestion, completeExam, deleteExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { createApp } from "../src/api/app";
import { generateExamPdf } from "../src/oral/pdf";

const TEST_TOKEN = "oral-pdf-del-token-do-not-use-in-prod-0123456789abcdef";

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-oral-pdf-del-${Date.now()}.db`);
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

/** Build a completed exam with a deterministic score. rates[1..8] → rating. */
async function buildCompletedExam(
  name: string,
  rates: Record<number, "richtig" | "teilweise richtig" | "falsch" | null>,
  notes: Record<number, string> = {},
  examiner = "Prüfer Test",
  examDate = "2026-08-17",
): Promise<string> {
  const { examId } = await createExam(client, { candidateName: name, examiner, examDate }, mulberry32(42));
  for (let order = 1; order <= 8; order++) {
    const r = rates[order] ?? null;
    await rateQuestion(client, examId, order, { rating: r, note: notes[order] ?? undefined });
  }
  await completeExam(client, examId);
  return examId;
}

/** Extract readable text from a pdfkit PDF (hex-encoded TJ arrays). */
function pdfText(buf: Buffer): string {
  const s = buf.toString("latin1");
  const out: string[] = [];
  // pdfkit encodes text as PDF hex strings (<4142...>) inside TJ arrays, with
  // kerning numbers between them. We collect every hex string in every
  // BT...ET text block and decode it (Latin-1 covers the German chars used).
  const blockRe = /BT[\s\S]*?ET/g;
  const hexRe = /<([0-9a-fA-F\s]+)>/g;
  let blk: RegExpExecArray | null;
  while ((blk = blockRe.exec(s)) !== null) {
    let hx: RegExpExecArray | null;
    hexRe.lastIndex = 0;
    const blockText: string[] = [];
    while ((hx = hexRe.exec(blk[0])) !== null) {
      const hex = hx[1].replace(/\s+/g, "");
      if (hex.length % 2 !== 0) continue;
      const bytes: number[] = [];
      for (let i = 0; i + 1 < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16));
      }
      blockText.push(Buffer.from(bytes).toString("latin1"));
    }
    // Join tokens within one text block, then separate blocks by a space so
    // wrapped words (e.g. "Teilweise" / "richtig" in a narrow column) rejoin.
    out.push(blockText.join(""));
    out.push(" ");
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

// ───────────────────────────── PDF ─────────────────────────────

describe("oral PDF evaluation", () => {
  it("generates a valid PDF buffer for a completed exam", async () => {
    const examId = await buildCompletedExam("PDF 100", { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" });
    const exam = await client.oralExam.findUnique({
      where: { id: examId },
      include: { candidate: true, items: { include: { question: true } } },
    });
    const buf = await generateExamPdf({
      id: exam!.id, candidate: exam!.candidate, examiner: exam!.examiner, examDate: exam!.examDate,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result as "Bestanden" | "Nicht bestanden" | null,
      items: exam!.items.map((it) => ({ orderKey: it.orderKey, themeName: it.themeName, weight: it.weight, rating: it.rating, points: it.points, note: it.note, question: it.question })),
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("100 % exam → PDF shows exactly 100 % (no FP drift)", async () => {
    const examId = await buildCompletedExam("PDF Hundred", { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.percent).toBe(100);
    const buf = await generateExamPdf({
      id: exam!.id, candidate: { id: "x", name: "PDF Hundred" }, examiner: null, examDate: null,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: [],
    });
    // The PDF stores the rounded percent text; 100 → "100 %"
    expect(pdfText(buf)).toContain("100 %");
    expect(pdfText(buf)).toContain("Bestanden");
  });

  it("55 % exam → PDF shows exactly 55 % (the canonical parity case)", async () => {
    // 10+6+14+7+18 = 55 (theme1 richtig, theme2 teilweise, theme3 richtig, theme4 teilweise, theme6 richtig)
    const examId = await buildCompletedExam("PDF FiftyFive", { 1: "richtig", 2: "teilweise richtig", 3: "richtig", 4: "teilweise richtig", 5: null, 6: "richtig", 7: null, 8: null });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.percent).toBe(55);
    const buf = await generateExamPdf({
      id: exam!.id, candidate: { id: "x", name: "PDF FiftyFive" }, examiner: null, examDate: null,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: [],
    });
    expect(pdfText(buf)).toContain("55 %");
    expect(pdfText(buf)).toContain("Bestanden");
    // No floating-point artefacts anywhere.
    expect(pdfText(buf)).not.toMatch(/55\.0+\s*%/);
  });

  it("nicht bestanden → PDF shows 'Nicht bestanden'", async () => {
    const examId = await buildCompletedExam("PDF Fail", { 1: "falsch", 2: "falsch", 3: "falsch", 4: "falsch", 5: "falsch", 6: "falsch", 7: "falsch", 8: "falsch" });
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    expect(exam!.result).toBe("Nicht bestanden");
    const buf = await generateExamPdf({
      id: exam!.id, candidate: { id: "x", name: "PDF Fail" }, examiner: null, examDate: null,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: [],
    });
    expect(pdfText(buf)).toContain("Nicht bestanden");
    expect(pdfText(buf)).toContain("0 %");
  });

  it("Prüfernotiz appears in the PDF", async () => {
    const examId = await buildCompletedExam(
      "PDF Note",
      { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" },
      { 2: "Antwort unvollständig, Nachbesserung empfohlen" },
    );
    const exam = await client.oralExam.findUnique({
      where: { id: examId },
      include: { candidate: true, items: { include: { question: true } } },
    });
    const buf = await generateExamPdf({
      id: exam!.id, candidate: exam!.candidate, examiner: exam!.examiner, examDate: exam!.examDate,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: exam!.items.map((it) => ({ orderKey: it.orderKey, themeName: it.themeName, weight: it.weight, rating: it.rating, points: it.points, note: it.note, question: it.question })),
    });
    expect(pdfText(buf)).toContain("Antwort unvollständig, Nachbesserung empfohlen");
  });

  it("Questions + ratings appear in the PDF", async () => {
    const examId = await buildCompletedExam("PDF Rows", { 1: "richtig", 2: "teilweise richtig", 3: "falsch", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" });
    const exam = await client.oralExam.findUnique({
      where: { id: examId },
      include: { candidate: true, items: { include: { question: true }, orderBy: { orderKey: "asc" } } },
    });
    const buf = await generateExamPdf({
      id: exam!.id, candidate: exam!.candidate, examiner: exam!.examiner, examDate: exam!.examDate,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: exam!.items.map((it) => ({ orderKey: it.orderKey, themeName: it.themeName, weight: it.weight, rating: it.rating, points: it.points, note: it.note, question: it.question })),
    });
    // A question text and at least one rating label survive in the stream.
    const q1 = exam!.items[0].question.question;
    expect(pdfText(buf)).toContain(q1.slice(0, Math.min(40, q1.length)));
    expect(pdfText(buf)).toContain("Teilweise richtig");
    expect(pdfText(buf)).toContain("Falsch");
  });

  it("renders without throwing on very long questions and notes (page break)", async () => {
    const examId = await buildCompletedExam(
      "PDF Long",
      { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" },
      {
        1: "Sehr ausführliche Prüfernotiz mit vielen Details. ".repeat(40),
        2: "Noch eine lange Notiz. ".repeat(30),
      },
    );
    const exam = await client.oralExam.findUnique({
      where: { id: examId },
      include: { candidate: true, items: { include: { question: true } } },
    });
    // Inject an artificially long question text to force wrapping.
    const items = exam!.items.map((it) => ({
      ...it,
      question: { ...it.question, question: it.question.question + " ".repeat(0) + "Zusätzliche Ausführlichkeit zur Fragestellung, die den Zeilenumbruch erzwingen soll und über mehrere Zeilen gehen muss. ".repeat(8) },
    }));
    const buf = await generateExamPdf({
      id: exam!.id, candidate: exam!.candidate, examiner: exam!.examiner, examDate: exam!.examDate,
      status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
      percent: exam!.percent, result: exam!.result,
      items: items.map((it) => ({ orderKey: it.orderKey, themeName: it.themeName, weight: it.weight, rating: it.rating, points: it.points, note: it.note, question: it.question })),
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("refuses to render a non-completed exam", async () => {
    const { examId } = await createExam(client, { candidateName: "PDF InProgress" }, mulberry32(7));
    const exam = await client.oralExam.findUnique({ where: { id: examId }, include: { candidate: true, items: { include: { question: true } } } });
    await expect(
      generateExamPdf({
        id: exam!.id, candidate: exam!.candidate, examiner: exam!.examiner, examDate: exam!.examDate,
        status: exam!.status, maxPoints: exam!.maxPoints, totalPoints: exam!.totalPoints,
        percent: exam!.percent, result: exam!.result,
        items: exam!.items.map((it) => ({ orderKey: it.orderKey, themeName: it.themeName, weight: it.weight, rating: it.rating, points: it.points, note: it.note, question: it.question })),
      }),
    ).rejects.toThrow(/completed/);
  });

  // ── API route GET /exams/:id/pdf ──

  it("GET /api/oral/exams/:id/pdf returns a PDF (200, application/pdf)", async () => {
    const examId = await buildCompletedExam("PDF Route", { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" });
    const res = await app.request(`/api/oral/exams/${examId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain("Auswertung_PDF Route.pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(pdfText(buf)).toContain("100 %");
  });

  it("GET /api/oral/exams/:id/pdf?download=1 sets attachment disposition", async () => {
    const examId = await buildCompletedExam("PDF Download", { 1: "richtig", 2: "richtig", 3: "richtig", 4: "richtig", 5: "richtig", 6: "richtig", 7: "richtig", 8: "richtig" });
    const res = await app.request(`/api/oral/exams/${examId}/pdf?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("GET /api/oral/exams/:id/pdf on an in-progress exam → 409", async () => {
    const { examId } = await createExam(client, { candidateName: "PDF NotDone" }, mulberry32(11));
    const res = await app.request(`/api/oral/exams/${examId}/pdf`);
    expect(res.status).toBe(409);
  });

  it("GET /api/oral/exams/:id/pdf for unknown id → 404", async () => {
    const res = await app.request(`/api/oral/exams/nonexistent/pdf`);
    expect(res.status).toBe(404);
  });
});

// ───────────────────────────── DELETE ─────────────────────────────

describe("oral exam deletion", () => {
  it("DELETE removes the exam and its OralExamQuestion slots (service)", async () => {
    const { examId } = await createExam(client, { candidateName: "Del Svc" }, mulberry32(5));
    await rateQuestion(client, examId, 1, { rating: "richtig", note: "x" });
    const slotsBefore = await client.oralExamQuestion.count({ where: { examId } });
    expect(slotsBefore).toBe(8);

    const res = await deleteExam(client, examId);
    expect(res.deleted).toBe(true);

    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeNull();
    expect(await client.oralExamQuestion.count({ where: { examId } })).toBe(0);
  });

  it("DELETE does NOT remove OralQuestion (pool intact)", async () => {
    const before = await client.oralQuestion.count();
    const { examId } = await createExam(client, { candidateName: "Del Pool" }, mulberry32(6));
    await rateQuestion(client, examId, 1, { rating: "richtig" });
    await deleteExam(client, examId);
    const after = await client.oralQuestion.count();
    expect(after).toBe(before);
  });

  it("DELETE does NOT remove OralTheme", async () => {
    const before = await client.oralTheme.count();
    const { examId } = await createExam(client, { candidateName: "Del Theme" }, mulberry32(8));
    await deleteExam(client, examId);
    const after = await client.oralTheme.count();
    expect(after).toBe(before);
  });

  it("DELETE of a nonexistent exam throws 'exam not found'", async () => {
    await expect(deleteExam(client, "nonexistent-id-123")).rejects.toThrow(/exam not found/);
  });

  it("DELETE keeps a shared candidate (other exams still reference it)", async () => {
    // Same name → same candidate row (upsert in createExam).
    const a = await createExam(client, { candidateName: "Shared Cand" }, mulberry32(20));
    const b = await createExam(client, { candidateName: "Shared Cand" }, mulberry32(21));
    const candA = (await client.oralExam.findUnique({ where: { id: a.examId }, select: { candidateId: true } }))!.candidateId;
    const candB = (await client.oralExam.findUnique({ where: { id: b.examId }, select: { candidateId: true } }))!.candidateId;
    expect(candA).toBe(candB);

    // delete one — candidate must remain (the other exam still references it)
    await deleteExam(client, a.examId);
    expect(await client.oralCandidate.findUnique({ where: { id: candA } })).not.toBeNull();
    expect(await client.oralExam.findUnique({ where: { id: b.examId } })).not.toBeNull();

    // now delete the second — candidate should be GC'd (orphaned)
    await deleteExam(client, b.examId);
    expect(await client.oralCandidate.findUnique({ where: { id: candA } })).toBeNull();
  });

  // ── API route DELETE /exams/:id ──

  it("DELETE without auth → 401", async () => {
    const { examId } = await createExam(client, { candidateName: "Del Auth" }, mulberry32(31));
    const res = await app.request(`/api/oral/exams/${examId}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    // exam still present (nothing deleted)
    expect(await client.oralExam.findUnique({ where: { id: examId } })).not.toBeNull();
  });

  it("DELETE with wrong token → 401", async () => {
    const { examId } = await createExam(client, { candidateName: "Del Wrong" }, mulberry32(32));
    const res = await app.request(`/api/oral/exams/${examId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
    expect(await client.oralExam.findUnique({ where: { id: examId } })).not.toBeNull();
  });

  it("DELETE with auth removes the exam (route)", async () => {
    const { examId } = await createExam(client, { candidateName: "Del Route" }, mulberry32(33));
    await rateQuestion(client, examId, 1, { rating: "richtig" });
    const res = await app.request(`/api/oral/exams/${examId}`, { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeNull();
    expect(await client.oralExamQuestion.count({ where: { examId } })).toBe(0);
    // pool intact
    expect(await client.oralQuestion.count()).toBe(218);
    expect(await client.oralTheme.count()).toBe(8);
  });

  it("DELETE unknown id with auth → 404 (clean error)", async () => {
    const res = await app.request(`/api/oral/exams/does-not-exist`, { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/);
  });

  it("DELETE does not affect other exams (regression)", async () => {
    const keep = await createExam(client, { candidateName: "Del KeepOther" }, mulberry32(40));
    await rateQuestion(client, keep.examId, 1, { rating: "richtig" });
    const victim = await createExam(client, { candidateName: "Del Victim" }, mulberry32(41));
    await deleteExam(client, victim.examId);
    // the kept exam is untouched: same items, same rating
    const kept = await client.oralExam.findUnique({
      where: { id: keep.examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(kept).not.toBeNull();
    expect(kept!.items.length).toBe(8);
    expect(kept!.items[0].rating).toBe("richtig");
    expect(kept!.items[0].points).toBe(kept!.items[0].weight);
  });
});
