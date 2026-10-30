// PDF export + exam deletion — integration tests.
//
// The PDF must be a pure rendering of the STORED exam values (never a
// recomputation), so these tests compare the text inside the generated PDF
// against the values persisted in the database. Deletion must be transactional,
// must leave the question pool untouched, and must keep candidates that other
// exams still reference.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createExam, rateQuestion, completeExam, deleteExam, ExamNotFoundError } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { ORAL_QUESTIONS_PER_EXAM, ORAL_THEMES, ORAL_UVV_THEME } from "../src/oral/themes";
import { textWidth, PDF_METRICS } from "../src/oral/pdf-writer";
import { createApp } from "../src/api/app";
import { bootstrapAdmin } from "../src/auth/service";

const TEST_TOKEN = "pdf-delete-token-do-not-use-in-prod-0123456789ab";
const ADMIN_PW = "pdf-admin-passwort-123";
const EXAMINER_PW = "pdf-pruefer-passwort-456";

let dbPath: string;
let client: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `ihk-pdf-test-${Date.now()}.db`);
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
  await bootstrapAdmin(client);
  app = createApp();
}, 120_000);

afterAll(async () => {
  await disconnectPrisma();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  delete process.env.ADMIN_PASSWORD;
});

const adminToken = () => ({ Authorization: `Bearer ${TEST_TOKEN}` });

/**
 * Extract the visible text of a PDF by decoding the literal strings in its
 * content streams (WinAnsi + octal escapes, as written by pdf-writer.ts).
 */
function extractPdfText(pdf: Buffer): string {
  const latin = pdf.toString("latin1");
  const out: string[] = [];
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const raw = m[0].slice(1, -1);
    let s = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== "\\") {
        s += raw[i];
        continue;
      }
      const next = raw[i + 1];
      if (next >= "0" && next <= "7") {
        const oct = raw.slice(i + 1, i + 4);
        s += String.fromCharCode(parseInt(oct, 8));
        i += 3;
      } else {
        s += next;
        i += 1;
      }
    }
    out.push(s);
  }
  return out.join("\n");
}

/** A text operation recovered from the PDF content stream, with its position. */
interface PositionedText {
  /** Decoded visible text. */
  text: string;
  /** Left edge of the glyph run, in PDF points (origin bottom-left). */
  x: number;
  /** Baseline of the glyph run. The visible text sits above this. */
  baseline: number;
  size: number;
  bold: boolean;
}

/**
 * Recover every `BT ... Tm ... Tj ET` text operation with its real position.
 *
 * A content-stream text op looks like:
 *   q 0.000 0.000 0.000 rg BT /F2 10 Tf 1 0 0 1 64.00 700.00 Tm (Text) Tj ET Q
 * The two numbers before `Tm` are the translation, i.e. the left edge and the
 * baseline. Right-aligned text is already shifted by the writer, so `x` is the
 * true left edge in both cases. Presence-only assertions cannot catch an
 * overlap, so the layout test needs these coordinates.
 */
function extractPositionedText(pdf: Buffer): PositionedText[] {
  const latin = pdf.toString("latin1");
  const ops: PositionedText[] = [];
  const re =
    /BT \/(F1|F2) ([\d.]+) Tf 1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm (\((?:\\.|[^\\()])*\)) Tj ET/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    ops.push({
      text: decodePdfLiteral(m[5]),
      x: Number(m[3]),
      baseline: Number(m[4]),
      size: Number(m[2]),
      bold: m[1] === "F2",
    });
  }
  return ops;
}

/** Decode a PDF literal string (`(…)`) written with WinAnsi + octal escapes. */
function decodePdfLiteral(literal: string): string {
  const raw = literal.slice(1, -1);
  let s = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") {
      s += raw[i];
      continue;
    }
    const next = raw[i + 1];
    if (next >= "0" && next <= "7") {
      s += String.fromCharCode(parseInt(raw.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      s += next;
      i += 1;
    }
  }
  return s;
}

/** Helvetica metrics: how far glyphs rise above / fall below the baseline. */
const ASCENT_RATIO = 0.72;
const DESCENT_RATIO = 0.24;

/** Vertical extent of a positioned text run (y grows upwards). */
function textExtent(t: PositionedText): { top: number; bottom: number } {
  return {
    top: t.baseline + ASCENT_RATIO * t.size,
    bottom: t.baseline - DESCENT_RATIO * t.size,
  };
}

/** Horizontal extent of a positioned text run. */
function textSpan(t: PositionedText): { left: number; right: number } {
  const width = textWidth(t.text, t.size, t.bold ? "bold" : "regular");
  return { left: t.x, right: t.x + width };
}

/** A filled rectangle recovered from the PDF content stream. */
interface PositionedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fill colour as written by the writer, e.g. "0.941 0.992 0.957". */
  fill: string;
}

/** Recover every filled `re f` rectangle with its geometry. */
function extractFilledRects(pdf: Buffer): PositionedRect[] {
  const latin = pdf.toString("latin1");
  const rects: PositionedRect[] = [];
  const re = /q ([\d.]+ [\d.]+ [\d.]+) rg (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f Q/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    rects.push({
      fill: m[1],
      x: Number(m[2]),
      y: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
    });
  }
  return rects;
}

/** The result box: full content width and the known box height. */
function findResultBox(pdf: Buffer): PositionedRect {
  const box = extractFilledRects(pdf).find(
    (r) => r.height === 64 && Math.abs(r.width - (PDF_METRICS.PAGE_WIDTH - PDF_METRICS.MARGIN * 2)) < 0.01,
  );
  if (!box) throw new Error("result box not found in the PDF");
  return box;
}

async function createRatedExam(
  name: string,
  ratings: Array<"richtig" | "teilweise richtig" | "falsch" | null>,
  seed = 11,
  userId?: string | null,
) {
  const { examId } = await createExam(client, { candidateName: name, userId: userId ?? null }, mulberry32(seed));
  const items = await client.oralExamQuestion.findMany({
    where: { examId },
    orderBy: { orderKey: "asc" },
  });
  for (let i = 0; i < items.length; i++) {
    const rating = ratings[i] ?? null;
    if (rating) await rateQuestion(client, examId, items[i].orderKey, { rating });
  }
  return examId;
}

describe("PDF report — completed exams only", () => {
  let completedId: string;
  let draftId: string;

  beforeAll(async () => {
    // A completed exam with a known, mixed result.
    completedId = await createRatedExam(
      "PDF Prüfling",
      ["richtig", "richtig", "richtig", "richtig", "richtig", "richtig", "falsch", "falsch", "falsch", "falsch", "falsch", "falsch", "falsch"],
      21,
    );
    await completeExam(client, completedId);
    draftId = await createRatedExam("PDF Entwurf", ["richtig"], 22);
  });

  it("serves a PDF for a completed exam", async () => {
    const res = await app.request(`/api/oral/exams/${completedId}/pdf`, { headers: adminToken() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(buf.toString("latin1")).toContain("%%EOF");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("offers both inline (open) and attachment (download) dispositions", async () => {
    const inline = await app.request(`/api/oral/exams/${completedId}/pdf`, { headers: adminToken() });
    expect(inline.headers.get("content-disposition")).toMatch(/^inline; filename=".+\.pdf"$/);

    const download = await app.request(`/api/oral/exams/${completedId}/pdf?disposition=attachment`, {
      headers: adminToken(),
    });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.pdf"$/);
  });

  it("marks the PDF as private / not cacheable", async () => {
    const res = await app.request(`/api/oral/exams/${completedId}/pdf`, { headers: adminToken() });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects an unknown exam with 404", async () => {
    const res = await app.request("/api/oral/exams/does-not-exist/pdf", { headers: adminToken() });
    expect(res.status).toBe(404);
  });

  it("rejects a non-completed exam with 409", async () => {
    const res = await app.request(`/api/oral/exams/${draftId}/pdf`, { headers: adminToken() });
    expect(res.status).toBe(409);
  });

  it("rejects anonymous access with 401", async () => {
    expect((await app.request(`/api/oral/exams/${completedId}/pdf`)).status).toBe(401);
  });
});

describe("PDF content matches the stored results", () => {
  it("renders the persisted total, percent and result verbatim", async () => {
    const examId = await createRatedExam(
      "Parität Prüfling",
      ["richtig", "teilweise richtig", "falsch", "richtig", "richtig", "teilweise richtig", "falsch", "falsch", "falsch", "falsch", "falsch", "falsch", "falsch"],
      33,
    );
    await completeExam(client, examId);

    const stored = await client.oralExam.findUnique({ where: { id: examId } });
    expect(stored!.status).toBe("completed");

    const res = await app.request(`/api/oral/exams/${examId}/pdf`, { headers: adminToken() });
    const text = extractPdfText(Buffer.from(await res.arrayBuffer()));

    // The PDF must show exactly what the database holds — no recomputation.
    expect(text).toContain(`${Math.round(stored!.percent)} %`);
    expect(text).toContain(`${stored!.totalPoints} von ${stored!.maxPoints} Punkten`);
    expect(text).toContain(`${stored!.totalPoints} / ${stored!.maxPoints}`);
    expect(text).toContain(stored!.result!);
    expect(text).toContain("Parität Prüfling");
  });

  it("renders each stored per-question rating and point value", async () => {
    const examId = await createRatedExam(
      "Detail Prüfling",
      ["richtig", "teilweise richtig", "falsch", "richtig", "teilweise richtig", "falsch", "richtig", "falsch", "richtig", "falsch", "richtig", "falsch", "richtig"],
      44,
    );
    await completeExam(client, examId);

    const items = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
      include: { question: { select: { excelId: true } } },
    });

    const res = await app.request(`/api/oral/exams/${examId}/pdf`, { headers: adminToken() });
    const text = extractPdfText(Buffer.from(await res.arrayBuffer()));

    for (const item of items) {
      // Frage-ID is printed verbatim, so every pooled question shows up.
      expect(text).toContain(item.question.excelId);
      // The stored weight snapshot and the stored point value are rendered.
      expect(text).toContain(String(item.points));
      expect(text).toContain(String(item.weight));
    }
    // The rating labels are rendered as German text.
    expect(text).toContain("Teilweise richtig");
    expect(text).toContain("Richtig");
    expect(text).toContain("Falsch");
  });

  it("renders a PASS result and a FAIL result differently", async () => {
    const passId = await createRatedExam("Bestanden Prüfling", Array(13).fill("richtig"), 55);
    await completeExam(client, passId);
    const failId = await createRatedExam("Nicht bestanden Prüfling", Array(13).fill("falsch"), 56);
    await completeExam(client, failId);

    const passText = extractPdfText(
      Buffer.from(
        await (await app.request(`/api/oral/exams/${passId}/pdf`, { headers: adminToken() })).arrayBuffer(),
      ),
    );
    const failText = extractPdfText(
      Buffer.from(
        await (await app.request(`/api/oral/exams/${failId}/pdf`, { headers: adminToken() })).arrayBuffer(),
      ),
    );
    expect(passText).toContain("100 %");
    expect(passText).toContain("Bestanden");
    expect(failText).toContain("0 %");
    expect(failText).toContain("Nicht bestanden");
  });

  it("a historical exam's snapshotted weights are rendered, not today's theme weights", async () => {
    // Build an exam whose stored weights do NOT match the current theme table,
    // exactly like a pre-extension (8-question) exam would look.
    const candidate = await client.oralCandidate.create({ data: { name: `Historie ${Date.now()}` } });
    const legacyWeights = [10, 12, 14, 14, 8, 18, 8, 16];
    const questions = await client.oralQuestion.findMany({ take: 8 });
    const exam = await client.oralExam.create({
      data: {
        candidateId: candidate.id,
        status: "completed",
        completedAt: new Date(),
        maxPoints: 100,
        totalPoints: 64,
        percent: 64,
        result: "Bestanden",
        items: {
          create: legacyWeights.map((w, i) => ({
            questionId: questions[i].id,
            orderKey: i + 1,
            themeName: `Alt-Thema ${i + 1}`,
            weight: w,
            rating: i < 4 ? "richtig" : "falsch",
            points: i < 4 ? w : 0,
          })),
        },
      },
    });

    const res = await app.request(`/api/oral/exams/${exam.id}/pdf`, { headers: adminToken() });
    expect(res.status).toBe(200);
    const text = extractPdfText(Buffer.from(await res.arrayBuffer()));

    // 64 points is what the STORED values say (4 × 16 = 64) even though the
    // current 9-theme weighting could never produce that combination.
    expect(text).toContain("64 %");
    expect(text).toContain("64 von 100 Punkten");
    expect(text).toContain("Alt-Thema 1");
    expect(text).toContain("Alt-Thema 8");
    // The exam was not rewritten by rendering it.
    const after = await client.oralExam.findUnique({ where: { id: exam.id } });
    expect(after!.totalPoints).toBe(64);
    expect(after!.percent).toBe(64);
  });

  it("includes examiner notes when present", async () => {
    const examId = await createRatedExam("Notiz Prüfling", Array(13).fill("richtig"), 66);
    const items = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    await rateQuestion(client, examId, items[0].orderKey, { note: "Sehr sichere Antwort" });
    await completeExam(client, examId);

    const res = await app.request(`/api/oral/exams/${examId}/pdf`, { headers: adminToken() });
    const text = extractPdfText(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain("Sehr sichere Antwort");
  });

  it("paginates a 13-question report and numbers the pages", async () => {
    const examId = await createRatedExam("Seiten Prüfling", Array(13).fill("richtig"), 77);
    await completeExam(client, examId);
    const res = await app.request(`/api/oral/exams/${examId}/pdf`, { headers: adminToken() });
    const text = extractPdfText(Buffer.from(await res.arrayBuffer()));
    expect(text).toMatch(/Seite 1 von \d+/);
  });
});

// ── result box layout ──────────────────────────────────────────────────────
// Regression: "Gesamtergebnis" and "<n> von <m> Punkten" were both emitted at
// the box TOP baseline, so they overprinted each other and their ascenders rose
// above the box border. Presence-only assertions cannot see that, so these
// tests read the actual Tm coordinates out of the content stream.
describe("PDF result box layout", () => {
  let passId: string;
  let failId: string;
  let passPdf: Buffer;
  let failPdf: Buffer;

  beforeAll(async () => {
    passId = await createRatedExam("Layout Bestanden", Array(13).fill("richtig"), 91);
    await completeExam(client, passId);
    failId = await createRatedExam("Layout Durchgefallen", Array(13).fill("falsch"), 92);
    await completeExam(client, failId);
    passPdf = Buffer.from(
      await (await app.request(`/api/oral/exams/${passId}/pdf`, { headers: adminToken() })).arrayBuffer(),
    );
    failPdf = Buffer.from(
      await (await app.request(`/api/oral/exams/${failId}/pdf`, { headers: adminToken() })).arrayBuffer(),
    );
  });

  /** The four texts of the result box, located by their rendered content. */
  function resultBoxTexts(pdf: Buffer, totalPoints: number, maxPoints: number) {
    const ops = extractPositionedText(pdf);
    const one = (predicate: (t: PositionedText) => boolean, what: string): PositionedText => {
      const hits = ops.filter(predicate);
      expect(hits, `expected exactly one ${what} in the PDF`).toHaveLength(1);
      return hits[0];
    };
    return {
      label: one((t) => t.text === "Gesamtergebnis", '"Gesamtergebnis"'),
      points: one(
        (t) => t.text === `${totalPoints} von ${maxPoints} Punkten`,
        "points line",
      ),
      percent: one((t) => /^\d+ %$/.test(t.text), "percent"),
      status: one((t) => t.text === "Bestanden" || t.text === "Nicht bestanden", "status"),
    };
  }

  it("draws the label and the points line at different vertical positions", async () => {
    const stored = await client.oralExam.findUnique({ where: { id: passId } });
    const t = resultBoxTexts(passPdf, stored!.totalPoints, stored!.maxPoints);

    expect(t.label.baseline).not.toBeCloseTo(t.points.baseline, 1);
    // The points line sits BELOW the label (smaller y), with a real gap.
    expect(t.points.baseline).toBeLessThan(t.label.baseline);
    const gap = t.label.baseline - t.points.baseline;
    // Far enough apart that the 11pt points line cannot reach the 10pt label.
    expect(gap).toBeGreaterThan(ASCENT_RATIO * t.points.size + DESCENT_RATIO * t.label.size);

    // Their visible boxes must not intersect either.
    const labelBox = textExtent(t.label);
    const pointsBox = textExtent(t.points);
    expect(pointsBox.top).toBeLessThan(labelBox.bottom);
  });

  it("keeps both left-hand texts inside the result box", async () => {
    const stored = await client.oralExam.findUnique({ where: { id: passId } });
    const box = findResultBox(passPdf);
    const boxTop = box.y + box.height;
    const boxBottom = box.y;
    const t = resultBoxTexts(passPdf, stored!.totalPoints, stored!.maxPoints);

    for (const [name, op] of [["Gesamtergebnis", t.label], ["points", t.points]] as const) {
      const e = textExtent(op);
      // Fully inside: no part of the glyph box crosses the border.
      expect(e.top, `${name} rises above the result box`).toBeLessThanOrEqual(boxTop);
      expect(e.bottom, `${name} drops below the result box`).toBeGreaterThanOrEqual(boxBottom);
      // And not on the border line itself.
      expect(e.top, `${name} touches the top border`).toBeLessThan(boxTop);
      expect(e.bottom, `${name} touches the bottom border`).toBeGreaterThan(boxBottom);
    }
    // The left group starts inside the box's left padding.
    expect(t.label.x).toBeGreaterThan(box.x);
    expect(t.points.x).toBeGreaterThan(box.x);
  });

  it("separates the left text group from the right-hand percent and status", async () => {
    const stored = await client.oralExam.findUnique({ where: { id: passId } });
    const t = resultBoxTexts(passPdf, stored!.totalPoints, stored!.maxPoints);

    // Right-hand texts are right-aligned to the same edge.
    const rightEdge = PDF_METRICS.PAGE_WIDTH - PDF_METRICS.MARGIN - 16;
    expect(textSpan(t.percent).right).toBeCloseTo(rightEdge, 1);
    expect(textSpan(t.status).right).toBeCloseTo(rightEdge, 1);

    // No horizontal intersection between the left group and the right group.
    const leftGroup = [t.label, t.points].map(textSpan);
    const rightGroup = [t.percent, t.status].map(textSpan);
    for (const l of leftGroup) {
      for (const r of rightGroup) {
        expect(l.right, `left text overlaps "${r === rightGroup[0] ? "percent" : "status"}"`)
          .toBeLessThan(r.left);
      }
    }

    // The percent and the status do not collide with each other vertically.
    expect(textExtent(t.status).top).toBeLessThan(textExtent(t.percent).bottom);
    // Both stay inside the box vertically.
    const box = findResultBox(passPdf);
    for (const op of [t.percent, t.status]) {
      const e = textExtent(op);
      expect(e.top).toBeLessThanOrEqual(box.y + box.height);
      expect(e.bottom).toBeGreaterThanOrEqual(box.y);
    }
  });

  it("leaves a gap between the result box and the following table header", async () => {
    const box = findResultBox(passPdf);
    const boxBottom = box.y;
    // The table header row is the next filled rect below the box.
    const nextRect = extractFilledRects(passPdf)
      .filter((r) => r.y + r.height <= boxBottom + 0.01)
      .sort((a, b) => (b.y + b.height) - (a.y + a.height))[0];
    expect(nextRect, "no table header below the result box").toBeTruthy();
    const gap = boxBottom - (nextRect.y + nextRect.height);
    expect(gap).toBeGreaterThanOrEqual(12);

    // No text from the result box intrudes into that gap.
    const stored = await client.oralExam.findUnique({ where: { id: passId } });
    const t = resultBoxTexts(passPdf, stored!.totalPoints, stored!.maxPoints);
    for (const op of [t.points, t.status]) {
      expect(textExtent(op).bottom).toBeGreaterThan(boxBottom);
    }
  });

  it("still renders the stored points, percent and result unchanged", async () => {
    const pass = await client.oralExam.findUnique({ where: { id: passId } });
    const fail = await client.oralExam.findUnique({ where: { id: failId } });
    expect(pass!.result).toBe("Bestanden");
    expect(fail!.result).toBe("Nicht bestanden");

    const p = resultBoxTexts(passPdf, pass!.totalPoints, pass!.maxPoints);
    expect(p.points.text).toBe(`${pass!.totalPoints} von ${pass!.maxPoints} Punkten`);
    expect(p.percent.text).toBe(`${Math.round(pass!.percent)} %`);
    expect(p.status.text).toBe(pass!.result);

    const f = resultBoxTexts(failPdf, fail!.totalPoints, fail!.maxPoints);
    expect(f.points.text).toBe(`${fail!.totalPoints} von ${fail!.maxPoints} Punkten`);
    expect(f.percent.text).toBe(`${Math.round(fail!.percent)} %`);
    expect(f.status.text).toBe(fail!.result);

    // The values are the persisted ones, not a recomputation.
    expect(pass!.totalPoints).toBe(100);
    expect(pass!.percent).toBe(100);
    expect(fail!.totalPoints).toBe(0);
    expect(fail!.percent).toBe(0);
  });

  it("lays out a pass and a fail exam with the same geometry", async () => {
    // Only the colours and the texts differ; the box and the baselines must not.
    const passBox = findResultBox(passPdf);
    const failBox = findResultBox(failPdf);
    expect(passBox.y).toBeCloseTo(failBox.y, 2);
    expect(passBox.fill).not.toBe(failBox.fill);

    const passStored = await client.oralExam.findUnique({ where: { id: passId } });
    const failStored = await client.oralExam.findUnique({ where: { id: failId } });
    const p = resultBoxTexts(passPdf, passStored!.totalPoints, passStored!.maxPoints);
    const f = resultBoxTexts(failPdf, failStored!.totalPoints, failStored!.maxPoints);
    expect(p.label.baseline).toBeCloseTo(f.label.baseline, 2);
    expect(p.points.baseline).toBeCloseTo(f.points.baseline, 2);
    expect(p.percent.baseline).toBeCloseTo(f.percent.baseline, 2);
    expect(p.status.baseline).toBeCloseTo(f.status.baseline, 2);
  });

  it("keeps the widest possible values inside the box", async () => {
    // "100 von 100 Punkten" and "Nicht bestanden" are the widest strings the
    // box can ever hold; neither may cross the box padding or the other group.
    const box = findResultBox(passPdf);
    const rightEdge = PDF_METRICS.PAGE_WIDTH - PDF_METRICS.MARGIN - 16;
    const leftWidth = textWidth("100 von 100 Punkten", 11, "regular");
    const rightWidth = textWidth("Nicht bestanden", 12, "bold");
    const leftEnd = PDF_METRICS.MARGIN + 16 + leftWidth;
    const rightStart = rightEdge - rightWidth;
    expect(leftEnd).toBeLessThan(rightStart);
    expect(rightStart).toBeGreaterThan(box.x + box.width / 2);
  });
});

describe("PDF access control", () => {
  let ownId: string;
  let foreignId: string;
  let examinerCookie: string;

  beforeAll(async () => {
    await app.request("/api/users", {
      method: "POST",
      headers: { ...adminToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pdfpruefer", password: EXAMINER_PW, role: "examiner" }),
    });
    const user = await client.user.findUnique({ where: { username: "pdfpruefer" } });

    // One exam attributed to that examiner, one created by somebody else.
    ownId = await createRatedExam("Eigene PDF-Prüfung", Array(13).fill("richtig"), 88, user!.id);
    await completeExam(client, ownId);
    foreignId = await createRatedExam("Fremde PDF-Prüfung", Array(13).fill("richtig"), 89);
    await completeExam(client, foreignId);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pdfpruefer", password: EXAMINER_PW }),
    });
    examinerCookie = (login.headers.get("set-cookie") ?? "").match(/ihk_session=([^;]+)/)![1];
  });

  // PDF export belongs to the shared examiner area, so any signed-in examiner
  // may export any exam — the same reach they have for reading and rating.
  it("an examiner can download the PDF of an exam they created", async () => {
    const res = await app.request(`/api/oral/exams/${ownId}/pdf`, {
      headers: { cookie: `ihk_session=${examinerCookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });

  it("an examiner can also download a colleague's exam PDF", async () => {
    const res = await app.request(`/api/oral/exams/${foreignId}/pdf`, {
      headers: { cookie: `ihk_session=${examinerCookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });

  it("the admin can download any PDF", async () => {
    expect((await app.request(`/api/oral/exams/${ownId}/pdf`, { headers: adminToken() })).status).toBe(200);
    expect((await app.request(`/api/oral/exams/${foreignId}/pdf`, { headers: adminToken() })).status).toBe(200);
  });

  it("anonymous requests are rejected (401)", async () => {
    expect((await app.request(`/api/oral/exams/${ownId}/pdf`)).status).toBe(401);
  });

  it("an unknown exam is 404", async () => {
    expect((await app.request("/api/oral/exams/nope/pdf", { headers: adminToken() })).status).toBe(404);
  });

  it("a not-yet-completed exam is refused (409)", async () => {
    const draftId = await createRatedExam("Noch offen", [], 990);
    const res = await app.request(`/api/oral/exams/${draftId}/pdf`, { headers: adminToken() });
    expect(res.status).toBe(409);
  });
});

describe("exam deletion", () => {
  it("requires explicit confirmation (400 without it)", async () => {
    const examId = await createRatedExam("Ohne Bestätigung", Array(13).fill("richtig"), 101);
    const res = await app.request(`/api/oral/exams/${examId}`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/confirmation/i);
    // Nothing was deleted.
    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeTruthy();
  });

  it("an aborted confirmation leaves the exam completely untouched", async () => {
    const examId = await createRatedExam("Abgebrochen", Array(13).fill("richtig"), 102);
    await completeExam(client, examId);
    const before = await client.oralExam.findUnique({
      where: { id: examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });

    // The UI "cancel" path simply never issues the request; a rejected request
    // must therefore be indistinguishable from no request at all.
    await app.request(`/api/oral/exams/${examId}`, { method: "DELETE", headers: adminToken() });

    const after = await client.oralExam.findUnique({
      where: { id: examId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(JSON.stringify(after)).toEqual(JSON.stringify(before));
  });

  it("deletes the exam and its dependent question entries", async () => {
    const examId = await createRatedExam("Zu löschen", Array(13).fill("richtig"), 103);
    await completeExam(client, examId);
    expect(await client.oralExamQuestion.count({ where: { examId } })).toBe(ORAL_QUESTIONS_PER_EXAM);

    const res = await app.request(`/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedItems).toBe(ORAL_QUESTIONS_PER_EXAM);

    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeNull();
    expect(await client.oralExamQuestion.count({ where: { examId } })).toBe(0);
  });

  it("never touches the question pool or the themes", async () => {
    const themesBefore = await client.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
    const questionsBefore = await client.oralQuestion.findMany({
      orderBy: { excelId: "asc" },
      select: { id: true, excelId: true, themeId: true, question: true, answer: true },
    });
    const examIdsBefore = (await client.oralExam.findMany({ select: { id: true } })).map((e) => e.id);

    const examId = await createRatedExam("Pool-Integrität", Array(13).fill("richtig"), 104);
    await app.request(`/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });

    const themesAfter = await client.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
    const questionsAfter = await client.oralQuestion.findMany({
      orderBy: { excelId: "asc" },
      select: { id: true, excelId: true, themeId: true, question: true, answer: true },
    });
    expect(JSON.stringify(themesAfter)).toEqual(JSON.stringify(themesBefore));
    expect(JSON.stringify(questionsAfter)).toEqual(JSON.stringify(questionsBefore));
    expect(questionsAfter.length).toBe(377);
    expect(themesAfter.length).toBe(ORAL_THEMES.length);

    // Only the intended exam disappeared; every other exam still exists.
    const examIdsAfter = (await client.oralExam.findMany({ select: { id: true } })).map((e) => e.id);
    expect(examIdsBefore.every((id) => examIdsAfter.includes(id))).toBe(true);
    expect(examIdsAfter).not.toContain(examId);
  });

  it("keeps candidates that other exams still reference", async () => {
    const candidate = await client.oralCandidate.create({ data: { name: `Geteilt ${Date.now()}` } });
    const keep = await createExam(client, { candidateName: candidate.name }, mulberry32(105));
    const drop = await createExam(client, { candidateName: candidate.name }, mulberry32(106));
    expect(keep.examId).not.toBe(drop.examId);
    // Both exams share the candidate row (upsert by name).
    expect(await client.oralExam.count({ where: { candidateId: candidate.id } })).toBe(2);

    await app.request(`/api/oral/exams/${drop.examId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });

    // The candidate survives because the other exam still needs it.
    expect(await client.oralCandidate.findUnique({ where: { id: candidate.id } })).toBeTruthy();
    expect(await client.oralExam.findUnique({ where: { id: keep.examId } })).toBeTruthy();
  });

  it("removes an orphaned candidate together with its last exam", async () => {
    const { examId } = await createExam(client, { candidateName: `Einzeln ${Date.now()}` }, mulberry32(107));
    const exam = await client.oralExam.findUnique({ where: { id: examId } });
    const res = await app.request(`/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deletedCandidates).toEqual([exam!.candidateId]);
    expect(await client.oralCandidate.findUnique({ where: { id: exam!.candidateId } })).toBeNull();
  });

  it("returns 404 for an unknown exam and deletes nothing", async () => {
    const examsBefore = await client.oralExam.count();
    const res = await app.request("/api/oral/exams/nope?confirm=true", {
      method: "DELETE",
      headers: adminToken(),
    });
    expect(res.status).toBe(404);
    expect(await client.oralExam.count()).toBe(examsBefore);
  });

  it("is idempotent-safe: a second delete of the same exam is 404", async () => {
    const examId = await createRatedExam("Doppelt löschen", Array(13).fill("richtig"), 108);
    expect(
      (
        await app.request(`/api/oral/exams/${examId}?confirm=true`, {
          method: "DELETE",
          headers: adminToken(),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/oral/exams/${examId}?confirm=true`, {
          method: "DELETE",
          headers: adminToken(),
        })
      ).status,
    ).toBe(404);
  });

  it("accepts the confirmation via header as well", async () => {
    const examId = await createRatedExam("Header-Bestätigung", Array(13).fill("richtig"), 109);
    const res = await app.request(`/api/oral/exams/${examId}`, {
      method: "DELETE",
      headers: { ...adminToken(), "x-confirm-delete": "true" },
    });
    expect(res.status).toBe(200);
  });

  it("refuses anonymous deletion", async () => {
    const examId = await createRatedExam("Geschützt", Array(13).fill("richtig"), 110);
    expect(
      (await app.request(`/api/oral/exams/${examId}?confirm=true`, { method: "DELETE" })).status,
    ).toBe(401);
    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeTruthy();
  });

  it("allows an examiner to delete (shared examiner area)", async () => {
    const examId = await createRatedExam("Prüfer löscht", Array(13).fill("richtig"), 111);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pdfpruefer", password: EXAMINER_PW }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").match(/ihk_session=([^;]+)/)![1];
    const res = await app.request(`/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
      headers: { cookie: `ihk_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await client.oralExam.findUnique({ where: { id: examId } })).toBeNull();
  });

  it("the service layer reports an unknown exam without writing", async () => {
    await expect(deleteExam(client, "missing-id")).rejects.toBeInstanceOf(ExamNotFoundError);
  });

  it("the remaining list no longer contains the deleted exam", async () => {
    const examId = await createRatedExam("Listen-Test", Array(13).fill("richtig"), 111);
    await app.request(`/api/oral/exams/${examId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });
    const res = await app.request("/api/oral/exams?limit=200", { headers: adminToken() });
    const ids = (await res.json()).data.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(examId);
  });
});

describe("13-question logic is untouched by the new features", () => {
  it("a fresh exam still has 13 questions across 9 themes with exactly one UVV", async () => {
    const { examId } = await createExam(client, { candidateName: "Logik-Check" }, mulberry32(1201));
    const items = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    expect(items.length).toBe(ORAL_QUESTIONS_PER_EXAM);
    expect(items.length).toBe(13);
    expect(items.map((i) => i.orderKey)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(items.slice(0, 9).map((i) => i.themeName)).toEqual(ORAL_THEMES.map((t) => t.name));
    expect(items.filter((i) => i.themeName === ORAL_UVV_THEME).length).toBe(1);
    const perTheme = new Map<string, number>();
    for (const i of items) perTheme.set(i.themeName, (perTheme.get(i.themeName) ?? 0) + 1);
    expect(Math.max(...perTheme.values())).toBeLessThanOrEqual(2);
    expect(new Set(items.map((i) => i.questionId)).size).toBe(13);
    expect(items.reduce((s, i) => s + i.weight, 0)).toBe(100);
  });

  it("scoring is unchanged: all richtig → 100/Bestanden, all teilweise → 50", async () => {
    const full = await createRatedExam("Voll", Array(13).fill("richtig"), 1202);
    await completeExam(client, full);
    const fullExam = await client.oralExam.findUnique({ where: { id: full } });
    expect(fullExam!.totalPoints).toBe(100);
    expect(fullExam!.percent).toBe(100);
    expect(fullExam!.result).toBe("Bestanden");

    const half = await createRatedExam("Halb", Array(13).fill("teilweise richtig"), 1203);
    await completeExam(client, half);
    const halfExam = await client.oralExam.findUnique({ where: { id: half } });
    expect(halfExam!.totalPoints).toBe(50);
    expect(halfExam!.result).toBe("Bestanden"); // 50 is exactly the threshold
  });

  it("deleting one exam does not alter another exam's stored ratings", async () => {
    const keepId = await createRatedExam("Bleibt", ["richtig", "falsch", "richtig"], 1204);
    const dropId = await createRatedExam("Verschwindet", Array(13).fill("richtig"), 1205);
    const keepBefore = await client.oralExam.findUnique({
      where: { id: keepId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });

    await app.request(`/api/oral/exams/${dropId}?confirm=true`, {
      method: "DELETE",
      headers: adminToken(),
    });

    const keepAfter = await client.oralExam.findUnique({
      where: { id: keepId },
      include: { items: { orderBy: { orderKey: "asc" } } },
    });
    expect(JSON.stringify(keepAfter)).toEqual(JSON.stringify(keepBefore));
  });
});
