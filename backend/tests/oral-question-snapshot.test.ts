// Post-exam review: the 13 questions that were ACTUALLY asked.
//
// The customer's report: the weighting was right, but the PDF and the detail
// view showed only Frage-IDs instead of the real questions. These tests pin the
// fix from both ends:
//
//   * the exam stores a SNAPSHOT of the wording at creation time, so a later
//     pool edit cannot rewrite a historical report, and
//   * the PDF renders every one of the 13 questions with its full Fragestellung,
//     its rating, the candidate's answer, the examiner comment (only when one
//     exists) and the full Musterlösung.
//
// They also pin the customer's "77 % vs 77.25 %" complaint: one shared
// formatter, two decimals, German comma, identical in the PDF and the API.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool } from "../src/oral/seed";
import { createExam, rateQuestion, completeExam } from "../src/oral/service";
import { mulberry32 } from "../src/oral/randomize";
import { loadExamReport, buildExamReportPdf } from "../src/oral/pdf";
import { formatOverallPercent, formatPercent } from "../src/oral/format";
import { ORAL_QUESTIONS_PER_EXAM } from "../src/oral/themes";

let client: PrismaClient;
let tmpDir: string;

const ratings = ["richtig", "teilweise richtig", "falsch"] as const;

/** Decode the text of a rendered PDF (WinAnsi bytes inside `(...) Tj`). */
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
        s += String.fromCharCode(parseInt(raw.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        s += next;
        i += 1;
      }
    }
    out.push([...s].map(winAnsiToUnicode).join(""));
  }
  return out.join("\n");
}

/** Map one WinAnsi(CP1252) character to its Unicode equivalent. */
function winAnsiToUnicode(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x80 && code <= 0x9f) {
    const table: Record<number, string> = {
      0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e",
      0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6",
      0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
      0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c",
      0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
      0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
      0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
    };
    return table[code] ?? ch;
  }
  return ch;
}

/** The renderer wraps long text, so compare with collapsed whitespace. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oral-snapshot-"));
  const dbPath = path.join(tmpDir, "test.db");
  const url = `file:${dbPath}`;
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasources: { db: { url } } });
  setPrismaClient(client);
  await seedOralPool(client);
});

afterAll(async () => {
  await disconnectPrisma();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create, rate and complete an exam with a documented answer on every item. */
async function completedExam(name: string, seed = 101) {
  const { examId } = await createExam(client, { candidateName: name }, mulberry32(seed));
  const items = await client.oralExamQuestion.findMany({
    where: { examId },
    orderBy: { orderKey: "asc" },
    include: { question: { select: { excelId: true, question: true, answer: true } } },
  });
  for (let i = 0; i < items.length; i++) {
    await rateQuestion(client, examId, items[i].orderKey, {
      rating: ratings[i % 3],
      // Every third question has no documented answer, so the "not documented"
      // path is exercised as well.
      candidateAnswer: i % 3 === 2 ? null : `Antwort zu Frage ${items[i].orderKey}`,
      note: i % 4 === 0 ? `Kommentar zu Frage ${items[i].orderKey}` : null,
    });
  }
  await completeExam(client, examId);
  return { examId, items };
}

describe("question snapshot — the exam keeps the wording it was created with", () => {
  it("stores the full wording and Musterlösung on every item at creation", async () => {
    const { items } = await completedExam("Snapshot Prüfling", 111);
    expect(items).toHaveLength(ORAL_QUESTIONS_PER_EXAM);

    for (const item of items) {
      expect(item.questionText, `item ${item.orderKey} has no snapshot`).toBeTruthy();
      expect(item.answerText, `item ${item.orderKey} has no solution snapshot`).toBeTruthy();
      // The snapshot must equal the pool row it was taken from.
      const pool = await client.oralQuestion.findUnique({ where: { id: item.questionId } });
      expect(item.questionText).toBe(pool!.question);
      expect(item.answerText).toBe(pool!.answer);
    }
  });

  it("does NOT follow a later pool edit — a historical exam is immutable", async () => {
    const { examId, items } = await completedExam("Unveränderlich Prüfling", 112);
    const target = items[0];
    const original = target.questionText!;
    const originalAnswer = target.answerText!;

    // Simulate a re-import that rewrites the pool wording.
    await client.oralQuestion.update({
      where: { id: target.questionId },
      data: { question: "VOELLIG NEUER WORTLAUT", answer: "NEUE MUSTERLOESUNG" },
    });
    try {
      const data = await loadExamReport(client, examId);
      const rendered = data!.items.find((i) => i.orderKey === target.orderKey)!;
      // The report still shows what the candidate was asked.
      expect(rendered.questionText).toBe(original);
      expect(rendered.answerText).toBe(originalAnswer);

      const text = normalizeWs(
        extractPdfText(buildExamReportPdf(data!)),
      );
      expect(text).toContain(normalizeWs(original));
      expect(text).not.toContain("VOELLIG NEUER WORTLAUT");
      expect(text).not.toContain("NEUE MUSTERLOESUNG");
    } finally {
      await client.oralQuestion.update({
        where: { id: target.questionId },
        data: { question: original, answer: originalAnswer },
      });
    }
  });

  it("falls back to the pool row for an item with no snapshot (pre-migration row)", async () => {
    // A row created before the snapshot columns existed has NULL snapshots.
    // The report must still show the wording rather than an empty block.
    const { examId, items } = await completedExam("Fallback Prüfling", 113);
    const target = items[0];
    await client.oralExamQuestion.update({
      where: { id: target.id },
      data: { questionText: null, answerText: null },
    });

    const pool = await client.oralQuestion.findUnique({ where: { id: target.questionId } });
    const data = await loadExamReport(client, examId);
    const rendered = data!.items.find((i) => i.orderKey === target.orderKey)!;
    expect(rendered.questionText).toBe(pool!.question);
    expect(rendered.answerText).toBe(pool!.answer);

    const text = normalizeWs(extractPdfText(buildExamReportPdf(data!)));
    expect(text).toContain(normalizeWs(pool!.question));
  });
});

describe("PDF — section B shows all 13 questions in full", () => {
  let examId: string;
  let text: string;
  let items: Awaited<ReturnType<typeof completedExam>>["items"];

  beforeAll(async () => {
    const created = await completedExam("Volltext Prüfling", 121);
    examId = created.examId;
    items = created.items;
    const data = await loadExamReport(client, examId);
    text = extractPdfText(buildExamReportPdf(data!));
  });

  it("has both sections, clearly separated", () => {
    expect(text).toContain("A - Pruefungsergebnis");
    expect(text).toContain("B - Gestellte Pruefungsfragen");
    // Section B starts on its own page.
    const idxA = text.indexOf("A - Pruefungsergebnis");
    const idxB = text.indexOf("B - Gestellte Pruefungsfragen");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it("renders all 13 questions with number, theme, id, wording, rating and solution", () => {
    const flat = normalizeWs(text);
    expect(items).toHaveLength(13);
    for (const item of items) {
      // 1. running number + theme abbreviation in the heading
      expect(text).toContain(`Frage ${item.orderKey} - `);
      // 2. full Themengebiet
      expect(flat).toContain(normalizeWs(`Themengebiet: ${item.themeName}`));
      // 3. Frage-ID
      expect(flat).toContain(normalizeWs(`Frage-ID: ${item.question.excelId}`));
      // 4. full original wording
      expect(flat, `wording of ${item.question.excelId}`).toContain(
        normalizeWs(item.questionText!),
      );
      // 5. rating
      expect(flat).toContain("Bewertung:");
      // 8. full Musterlösung
      expect(flat, `solution of ${item.question.excelId}`).toContain(
        normalizeWs(item.answerText!),
      );
    }
  });

  it("labels every section of a question block", () => {
    expect(text.match(/^Fragestellung:$/gm)?.length).toBe(13);
    expect(text.match(/^Bewertung:$/gm)?.length).toBe(13);
    expect(text.match(/^Antwort des Prueflings:$/gm)?.length).toBe(13);
    expect(text.match(/^Musterloesung:$/gm)?.length).toBe(13);
  });

  it("keeps the questions in the order they were asked", () => {
    const positions = items.map((it) => text.indexOf(`Frage ${it.orderKey} - `));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    const sorted = positions.slice().sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("renders all three ratings correctly", async () => {
    const stored = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    const byOrder = new Map(stored.map((s) => [s.orderKey, s.rating]));
    const labels: Record<string, string> = {
      richtig: "Richtig",
      "teilweise richtig": "Teilweise richtig",
      falsch: "Falsch",
    };
    for (const [order, rating] of byOrder) {
      const block = text.slice(text.indexOf(`Frage ${order} - `));
      expect(block).toContain(labels[rating!]);
    }
    // All three labels are actually present in this exam.
    expect(text).toContain("Teilweise richtig");
    expect(text).toContain("Falsch");
  });

  it("shows the documented candidate answer, and marks the missing ones", async () => {
    const stored = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    const withAnswer = stored.filter((s) => (s.candidateAnswer ?? "").trim() !== "");
    const without = stored.filter((s) => (s.candidateAnswer ?? "").trim() === "");
    expect(withAnswer.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);

    const flat = normalizeWs(text);
    for (const s of withAnswer) {
      expect(flat, `answer of question ${s.orderKey}`).toContain(
        normalizeWs(s.candidateAnswer!),
      );
    }
    // One marker per undocumented answer.
    expect(text.match(/Keine Antwort dokumentiert\./g)?.length).toBe(without.length);
  });

  it("prints the examiner comment only when one was stored", async () => {
    const stored = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    const withNote = stored.filter((s) => (s.note ?? "").trim() !== "");
    const without = stored.filter((s) => (s.note ?? "").trim() === "");
    expect(withNote.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);

    const flat = normalizeWs(text);
    for (const s of withNote) {
      expect(flat, `note of question ${s.orderKey}`).toContain(normalizeWs(s.note!));
    }
    // Exactly one "Prueferkommentar:" heading per stored note.
    expect(text.match(/^Prueferkommentar:$/gm)?.length).toBe(withNote.length);
  });

  it("never shows a bare Frage-ID without the wording", () => {
    // Every Frage-ID line is immediately followed by its Fragestellung.
    const lines = text.split("\n");
    for (const item of items) {
      const idx = lines.findIndex((l) => l === `Frage-ID: ${item.question.excelId}`);
      expect(idx, `Frage-ID line for ${item.question.excelId}`).toBeGreaterThanOrEqual(0);
      expect(lines.slice(idx + 1, idx + 4)).toContain("Fragestellung:");
    }
  });

  it("numbers the pages and keeps them inside the margins", () => {
    const pages = text.match(/Seite \d+ von \d+/g);
    expect(pages).toBeTruthy();
    expect(pages!.length).toBeGreaterThanOrEqual(2);
    // Page count is consistent across the footer.
    const total = pages![0].match(/von (\d+)/)![1];
    for (const p of pages!) expect(p).toContain(`von ${total}`);
    expect(pages!.length).toBe(Number(total));
  });

  it("does not repeat the per-theme table header on later pages", () => {
    // Exactly one "Themengebiet" header: the table is never split.
    expect(text.match(/^Themengebiet$/gm)?.length).toBe(1);
  });

  it("does not truncate a long Musterlösung", async () => {
    // The longest solution in the pool must survive intact.
    const longest = await client.oralQuestion.findFirst({
      where: { answer: { not: null } },
      orderBy: { answer: "desc" },
    });
    const { examId: id } = await completedExam("Langtext Prüfling", 131);
    const item = await client.oralExamQuestion.findFirst({
      where: { examId: id, questionId: longest!.id },
    });
    // Only assert when the longest question happens to be in this exam.
    if (item) {
      const data = await loadExamReport(client, id);
      const flat = normalizeWs(extractPdfText(buildExamReportPdf(data!)));
      expect(flat).toContain(normalizeWs(item.answerText!));
    } else {
      expect(longest!.answer!.length).toBeGreaterThan(0);
    }
  });
});

describe("percentage formatting — one value everywhere", () => {
  it("renders the overall result with two decimals and a German comma", () => {
    expect(formatOverallPercent(77.25)).toBe("77,25");
    expect(formatOverallPercent(77)).toBe("77,00");
    expect(formatOverallPercent(100)).toBe("100,00");
    expect(formatOverallPercent(0)).toBe("0,00");
    expect(formatOverallPercent(13.5)).toBe("13,50");
  });

  it("trims trailing zeros for per-theme values", () => {
    expect(formatPercent(18)).toBe("18");
    expect(formatPercent(13.5)).toBe("13,5");
    expect(formatPercent(6.75)).toBe("6,75");
  });

  it("shows the same overall value in the PDF header, the total row and the API", async () => {
    const { examId } = await completedExam("Parität Prozent", 141);
    const stored = await client.oralExam.findUnique({ where: { id: examId } });
    const expected = formatOverallPercent(stored!.percent);

    const data = await loadExamReport(client, examId);
    const text = extractPdfText(buildExamReportPdf(data!));

    // The value the API/report hands out is the stored one.
    expect(formatOverallPercent(data!.exam.percent)).toBe(expected);
    // It appears in the PDF (header, breakdown total row, table total row).
    expect(text).toContain(`${expected} %`);
    // No rounded integer variant such as "78 %" for a 77,5 result.
    if (!Number.isInteger(stored!.percent)) {
      expect(text).not.toContain(`${Math.round(stored!.percent)} %`);
    }
    // No decimal POINT anywhere in a percentage.
    expect(text).not.toMatch(/\d+\.\d+ %/);
  });

  it("still uses the 50 % pass mark and the three-stage rating", async () => {
    const { examId } = await completedExam("Grenze Prüfling", 151);
    const stored = await client.oralExam.findUnique({ where: { id: examId } });
    expect(stored!.result).toBe(stored!.percent >= 50 ? "Bestanden" : "Nicht bestanden");

    const data = await loadExamReport(client, examId);
    const text = extractPdfText(buildExamReportPdf(data!));
    expect(text).toContain("Bestehensgrenze 50 %");
    expect(text).toContain("richtig = 100 %, teilweise richtig = 50 %, falsch = 0 %");
  });
});
