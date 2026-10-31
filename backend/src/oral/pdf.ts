// PDF report for a completed oral exam.
//
// The report has TWO clearly separated parts:
//
//   A) Pruefungsergebnis         - candidate, examiner, dates, status, id,
//                                  overall percent, pass mark, pass/fail and
//                                  the weighted table over all eight themes.
//   B) Gestellte Pruefungsfragen - all 13 questions ACTUALLY ASKED, each with
//                                  its full original wording, the rating, the
//                                  candidate's documented answer, the examiner
//                                  comment (only when present) and the full
//                                  Musterloesung.
//
// Two rules govern this file:
//
//  1. It is a pure RENDERER of already-persisted values. The overall percent
//     and the per-theme breakdown come from the stored exam (and the same
//     scorer the app uses), so the PDF can never disagree with the UI.
//  2. The question wording comes from the ITEM SNAPSHOT (questionText /
//     answerText), never from the live pool row, so editing the pool later
//     cannot rewrite a historical report. Items created before the snapshot
//     existed fall back to the linked pool row (see loadExamReport).

import type { PrismaClient } from "@prisma/client";
import {
  renderPdf,
  wrapText,
  textWidth,
  PDF_METRICS,
  type PageOp,
  type PdfFont,
} from "./pdf-writer";
import { scoreExam, type Rating } from "./scoring";
import { normalizeThemeName, shortThemeName, themeAbbreviation } from "./themes";
import { formatPercent, formatOverallPercent } from "./format";

const { PAGE_WIDTH, PAGE_HEIGHT, MARGIN } = PDF_METRICS;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLOR_PRIMARY = 0x1d4ed8;
const COLOR_TEXT = 0x111827;
const COLOR_MUTED = 0x6b7280;
const COLOR_BORDER = 0xd1d5db;
const COLOR_HEAD_BG = 0xeef2ff;
const COLOR_ROW_BG = 0xf9fafb;
const COLOR_PASS = 0x15803d;
const COLOR_FAIL = 0xb91c1c;
const COLOR_PARTIAL = 0xb45309;

/** Distance kept clear at the bottom of every page (the page number lives there). */
const BOTTOM_LIMIT = MARGIN + 34;

const RATING_LABEL: Record<string, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};

const RATING_COLOR: Record<string, number> = {
  richtig: COLOR_PASS,
  "teilweise richtig": COLOR_PARTIAL,
  falsch: COLOR_FAIL,
};

export interface ExamReportItem {
  orderKey: number;
  themeName: string;
  weight: number;
  rating: string | null;
  points: number;
  note: string | null;
  excelId: string;
  /** Full wording at exam time (snapshot), or the pool fallback. */
  questionText: string | null;
  /** Full Musterloesung at exam time (snapshot), or the pool fallback. */
  answerText: string | null;
  /** The candidate's documented answer, when one was written down. */
  candidateAnswer: string | null;
}

export interface ExamReportData {
  exam: {
    id: string;
    status: string;
    examDate: Date | null;
    examiner: string | null;
    completedAt: Date | null;
    /** 2 = weighted percentage (current), 1 = legacy points. */
    scoringVersion: number;
    // Legacy points fields: retained for pre-Phase-11 exams, never displayed.
    maxPoints: number;
    totalPoints: number;
    percent: number;
    result: string | null;
    createdAt: Date;
  };
  /** Weighted per-theme breakdown (percentage model). Empty for legacy exams. */
  breakdown: Array<{
    themeName: string;
    weight: number;
    asked: number;
    achieved: number;
    percent: number;
    contribution: number;
  }>;
  candidateName: string;
  items: ExamReportItem[];
}

/**
 * Load everything the report needs. Returns null for an unknown exam.
 *
 * The item snapshot is preferred; a NULL snapshot (row predates the snapshot
 * migration) falls back to the linked pool row. The fallback never invents
 * text: it shows the pool wording, which for such a row is the only surviving
 * copy.
 */
export async function loadExamReport(
  db: PrismaClient,
  examId: string,
): Promise<ExamReportData | null> {
  const exam = await db.oralExam.findUnique({
    where: { id: examId },
    include: {
      candidate: { select: { name: true } },
      items: {
        orderBy: { orderKey: "asc" },
        include: {
          question: { select: { excelId: true, question: true, answer: true } },
        },
      },
    },
  });
  if (!exam) return null;

  // Breakdown from the STORED ratings (identical maths to the app/API). Legacy
  // points exams have no percentage breakdown, so they report an empty list.
  const breakdown =
    exam.scoringVersion === 2
      ? scoreExam(
          exam.items.map((i) => ({
            themeName: normalizeThemeName(i.themeName),
            weight: i.weight,
            rating: (i.rating as Rating | null) ?? null,
          })),
        ).themes
      : [];

  return {
    exam: {
      id: exam.id,
      status: exam.status,
      examDate: exam.examDate,
      examiner: exam.examiner,
      completedAt: exam.completedAt,
      scoringVersion: exam.scoringVersion,
      maxPoints: exam.maxPoints,
      totalPoints: exam.totalPoints,
      percent: exam.percent,
      result: exam.result,
      createdAt: exam.createdAt,
    },
    breakdown,
    candidateName: exam.candidate.name,
    items: exam.items.map((i) => ({
      orderKey: i.orderKey,
      themeName: i.themeName,
      weight: i.weight,
      rating: i.rating,
      points: i.points,
      note: i.note,
      excelId: i.question.excelId,
      questionText: i.questionText ?? i.question.question,
      answerText: i.answerText ?? i.question.answer,
      candidateAnswer: i.candidateAnswer,
    })),
  };
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(d)}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} Uhr`;
}

/** Share of a question's value a rating yields: 100 / 50 / 0 (%). */
function itemShare(rating: string | null): number {
  if (rating === "richtig") return 100;
  if (rating === "teilweise richtig") return 50;
  return 0;
}

/**
 * Wrap text while keeping paragraph breaks. A blank entry marks a paragraph
 * gap. `wrapText` collapses ALL whitespace, so splitting on newlines first is
 * what preserves the bullet lists that several Musterloesungen use.
 */
function wrapParagraphs(
  text: string,
  size: number,
  font: PdfFont,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\n+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (out.length > 0) out.push("");
    out.push(...wrapText(trimmed, size, font, maxWidth));
  }
  return out.length > 0 ? out : [""];
}

/** Render the report as PDF bytes. */
export function buildExamReportPdf(data: ExamReportData): Buffer {
  const pages: PageOp[][] = [];
  let ops: PageOp[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = PAGE_HEIGHT - MARGIN;
  };

  /** Start a new page if `needed` points do not fit above the bottom limit. */
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM_LIMIT) newPage();
  };

  const put = (
    value: string,
    x: number,
    size: number,
    font: PdfFont = "regular",
    color = COLOR_TEXT,
    align: "left" | "right" = "left",
  ) => {
    ops.push({ kind: "text", x, y, text: value, size, font, color, align });
  };

  const advance = (n: number) => {
    y -= n;
  };

  const rule = (color = COLOR_BORDER) => {
    ops.push({
      kind: "line",
      x1: MARGIN,
      y1: y,
      x2: PAGE_WIDTH - MARGIN,
      y2: y,
      color,
    });
  };

  /**
   * Draw a wrapped paragraph, continuing on the next page when it runs long.
   * `onBreak` re-draws a context line at the top of the continuation page.
   */
  const paragraph = (
    text: string,
    opts: {
      size?: number;
      font?: PdfFont;
      color?: number;
      width?: number;
      lineHeight?: number;
      onBreak?: () => void;
    } = {},
  ): void => {
    const {
      size = 10,
      font = "regular" as PdfFont,
      color = COLOR_TEXT,
      width = CONTENT_WIDTH,
      lineHeight = 13,
      onBreak,
    } = opts;
    const lines = wrapParagraphs(text, size, font, width);
    for (const ln of lines) {
      if (ln === "") {
        // Paragraph gap: never let a gap alone push us onto a new page.
        if (y - lineHeight * 0.6 >= BOTTOM_LIMIT) advance(lineHeight * 0.6);
        continue;
      }
      if (y - lineHeight < BOTTOM_LIMIT) {
        newPage();
        onBreak?.();
      }
      ops.push({ kind: "text", x: MARGIN, y, text: ln, size, font, color, align: "left" });
      advance(lineHeight);
    }
  };

  // ----------------------------- SECTION A --------------------------------
  put("IHK Pruefungsuebersicht", MARGIN, 9, "bold", COLOR_MUTED);
  advance(14);
  put("Auswertung der muendlichen Pruefung (§ 34a)", MARGIN, 17, "bold", COLOR_PRIMARY);
  advance(6);
  rule();
  advance(10);

  put("A - Pruefungsergebnis", MARGIN, 11, "bold", COLOR_MUTED);
  advance(16);

  // -- exam metadata, two label/value pairs per row -------------------------
  const meta: Array<[string, string]> = [
    ["Pruefling", data.candidateName],
    ["Pruefer/in", data.exam.examiner || "-"],
    ["Pruefungsdatum", fmtDate(data.exam.examDate)],
    ["Abschlusszeitpunkt", fmtDateTime(data.exam.completedAt)],
    ["Pruefungsstatus", data.exam.status === "completed" ? "Abgeschlossen" : data.exam.status],
    ["Pruefungs-ID", data.exam.id],
  ];
  const metaLabelW = 92;
  const metaColW = CONTENT_WIDTH / 2;
  const metaValueMax = metaColW - metaLabelW - 14;
  for (let i = 0; i < meta.length; i += 2) {
    ensure(15);
    for (let c = 0; c < 2; c++) {
      const entry = meta[i + c];
      if (!entry) continue;
      const x = MARGIN + c * metaColW;
      ops.push({
        kind: "text",
        x,
        y,
        text: entry[0],
        size: 9,
        font: "bold",
        color: COLOR_MUTED,
      });
      // Clip an over-long value (a cuid) so it cannot reach the next column.
      let value = entry[1];
      const clipped = textWidth(value, 9, "regular") > metaValueMax;
      while (value.length > 4 && textWidth(value, 9, "regular") > metaValueMax) {
        value = value.slice(0, -2);
      }
      if (clipped) value = value.slice(0, -1) + ".";
      ops.push({ kind: "text", x: x + metaLabelW, y, text: value, size: 9, font: "regular" });
    }
    advance(15);
  }
  advance(8);

  // -- result box -----------------------------------------------------------
  // Every text is placed from the box TOP with an explicit baseline offset.
  // A baseline is the text's BOTTOM edge, so the visible glyphs extend roughly
  // 0.72 * size ABOVE it: a label placed at the box top would be drawn outside
  // the box, and two labels sharing one baseline would overprint each other.
  const overall = formatOverallPercent(data.exam.percent);
  const passed = data.exam.result === "Bestanden";
  const boxHeight = 68;
  ensure(boxHeight + 20);
  const boxTop = y;
  ops.push({
    kind: "rect",
    x: MARGIN,
    y: boxTop - boxHeight,
    width: CONTENT_WIDTH,
    height: boxHeight,
    fill: passed ? 0xf0fdf4 : 0xfef2f2,
    stroke: true,
  });
  ops.push({
    kind: "text",
    x: MARGIN + 16,
    y: boxTop - 15,
    text: "Gesamtergebnis",
    size: 10,
    font: "bold",
    color: COLOR_MUTED,
  });
  ops.push({
    kind: "text",
    x: MARGIN + 16,
    y: boxTop - 32,
    text: "Bestehensgrenze 50 %",
    size: 11,
    font: "regular",
    color: COLOR_TEXT,
  });
  ops.push({
    kind: "text",
    x: PAGE_WIDTH - MARGIN - 16,
    y: boxTop - 36,
    text: `${overall} %`,
    size: 26,
    font: "bold",
    color: passed ? COLOR_PASS : COLOR_FAIL,
    align: "right",
  });
  ops.push({
    kind: "text",
    x: PAGE_WIDTH - MARGIN - 16,
    y: boxTop - 55,
    text: data.exam.result ?? "-",
    size: 12,
    font: "bold",
    color: passed ? COLOR_PASS : COLOR_FAIL,
    align: "right",
  });
  y = boxTop - boxHeight - 22;

  // -- per-theme breakdown --------------------------------------------------
  if (data.breakdown.length > 0) {
    const bCols = [
      { label: "Themengebiet", width: 246, align: "left" as const },
      { label: "Ergebnis", width: 74, align: "right" as const },
      { label: "Gewichtung", width: 86, align: "right" as const },
      { label: "Beitrag zum Gesamtergebnis", width: 144, align: "right" as const },
    ];
    const bWidth = bCols.reduce((a, c) => a + c.width, 0);
    const bRowH = 16;
    const bHeadH = 22;
    const tableH = bHeadH + bRowH * (data.breakdown.length + 1);

    // Keep the whole table on one page: a split table would need its header
    // repeated, which the customer explicitly asked to avoid.
    ensure(tableH + 26);
    put("Auswertung nach allen acht Themengebieten", MARGIN, 12, "bold", COLOR_TEXT);
    advance(20);

    ops.push({
      kind: "rect",
      x: MARGIN,
      y: y - bHeadH,
      width: bWidth,
      height: bHeadH,
      fill: COLOR_HEAD_BG,
    });
    let bx = MARGIN;
    for (const c of bCols) {
      const lines = wrapText(c.label, 8, "bold", c.width - 10);
      lines.forEach((ln, li) => {
        ops.push({
          kind: "text",
          x: c.align === "right" ? bx + c.width - 5 : bx + 5,
          y: y - 10 - li * 9,
          text: ln,
          size: 8,
          font: "bold",
          color: COLOR_MUTED,
          align: c.align,
        });
      });
      bx += c.width;
    }
    y -= bHeadH;

    data.breakdown.forEach((b, i) => {
      if (i % 2 === 1) {
        ops.push({
          kind: "rect",
          x: MARGIN,
          y: y - bRowH,
          width: bWidth,
          height: bRowH,
          fill: COLOR_ROW_BG,
        });
      }
      const cells = [
        shortThemeName(b.themeName),
        `${formatPercent(b.percent)} %`,
        `${formatPercent(b.weight)} %`,
        `${formatPercent(b.contribution)} %`,
      ];
      let cx = MARGIN;
      cells.forEach((val, ci) => {
        const c = bCols[ci];
        ops.push({
          kind: "text",
          x: c.align === "right" ? cx + c.width - 5 : cx + 5,
          y: y - 11,
          text: val,
          size: 9,
          font: "regular",
          color: COLOR_TEXT,
          align: c.align,
        });
        cx += c.width;
      });
      ops.push({
        kind: "line",
        x1: MARGIN,
        y1: y - bRowH,
        x2: MARGIN + bWidth,
        y2: y - bRowH,
        color: COLOR_BORDER,
      });
      y -= bRowH;
    });

    // Total row: the contributions sum to the overall result.
    ops.push({
      kind: "rect",
      x: MARGIN,
      y: y - bRowH,
      width: bWidth,
      height: bRowH,
      fill: COLOR_HEAD_BG,
    });
    const totalCells = [
      "Gesamtergebnis",
      `${overall} %`,
      `${formatPercent(data.breakdown.reduce((a, b) => a + b.weight, 0))} %`,
      `${overall} %`,
    ];
    let tx = MARGIN;
    totalCells.forEach((val, ci) => {
      const c = bCols[ci];
      ops.push({
        kind: "text",
        x: c.align === "right" ? tx + c.width - 5 : tx + 5,
        y: y - 11,
        text: val,
        size: 9,
        font: "bold",
        color: COLOR_TEXT,
        align: c.align,
      });
      tx += c.width;
    });
    y -= bRowH + 16;
  }

  // Weighting note (belongs to section A, not to the individual questions).
  ensure(26);
  paragraph(
    "Die Themengewichtung wird nur hier ausgewiesen. Sie ist unabhaengig von der " +
      "Zahl der gestellten Fragen; das Gesamtergebnis ist die Summe der gewichteten " +
      "Themenbeitraege. In der Einzelauswertung steht die Bewertung der Frage.",
    { size: 8, color: COLOR_MUTED, lineHeight: 11 },
  );

  // ----------------------------- SECTION B --------------------------------
  newPage();
  put("IHK Pruefungsuebersicht", MARGIN, 9, "bold", COLOR_MUTED);
  advance(14);
  put("B - Gestellte Pruefungsfragen", MARGIN, 17, "bold", COLOR_PRIMARY);
  advance(6);
  rule();
  advance(10);
  put(
    `${data.items.length} Fragen, in der Reihenfolge der Pruefung. Die Fragestellungen ` +
      "und Musterloesungen sind die zum Pruefungszeitpunkt gespeicherten Fassungen.",
    MARGIN,
    8,
    "regular",
    COLOR_MUTED,
  );
  advance(20);

  data.items.forEach((item, idx) => {
    const abbr = themeAbbreviation(item.themeName);
    const ratingText = item.rating
      ? (RATING_LABEL[item.rating] ?? item.rating)
      : "Nicht bewertet";
    const ratingColor = item.rating ? (RATING_COLOR[item.rating] ?? COLOR_TEXT) : COLOR_MUTED;
    const continuation = () => {
      put(`Frage ${item.orderKey} - ${abbr} (Fortsetzung)`, MARGIN, 9, "bold", COLOR_MUTED);
      advance(14);
    };
    // A break INSIDE a question block must not leave a bare fragment at the top
    // of the next page: re-print which question is continuing.
    const ensureBlock = (needed: number) => {
      if (y - needed < BOTTOM_LIMIT) {
        newPage();
        continuation();
      }
    };

    // Keep the heading, the id and the first lines of the question together.
    ensure(110);

    put(`Frage ${item.orderKey} - ${abbr}`, MARGIN, 13, "bold", COLOR_PRIMARY);
    advance(16);
    put(`Themengebiet: ${item.themeName}`, MARGIN, 8, "regular", COLOR_MUTED);
    advance(12);
    put(`Frage-ID: ${item.excelId}`, MARGIN, 9, "bold", COLOR_TEXT);
    advance(14);

    // Fragestellung
    put("Fragestellung:", MARGIN, 9, "bold", COLOR_MUTED);
    advance(12);
    paragraph(item.questionText || "(Kein Fragentext gespeichert.)", {
      size: 10,
      onBreak: continuation,
    });
    advance(6);

    // Bewertung + the question's own share (the theme weight is NOT repeated here)
    ensureBlock(16);
    put("Bewertung:", MARGIN, 9, "bold", COLOR_MUTED);
    ops.push({
      kind: "text",
      x: MARGIN + 62,
      y,
      text: `${ratingText} (${formatPercent(itemShare(item.rating))} %)`,
      size: 10,
      font: "bold",
      color: ratingColor,
    });
    advance(16);

    // Antwort des Prueflings
    ensureBlock(30);
    put("Antwort des Prueflings:", MARGIN, 9, "bold", COLOR_MUTED);
    advance(12);
    const answer = (item.candidateAnswer ?? "").trim();
    if (answer) {
      paragraph(answer, { size: 10 });
    } else {
      put("Keine Antwort dokumentiert.", MARGIN, 10, "regular", COLOR_MUTED);
      advance(13);
    }
    advance(6);

    // Prueferkommentar - only when one was actually stored.
    const note = (item.note ?? "").trim();
    if (note) {
      ensureBlock(30);
      put("Prueferkommentar:", MARGIN, 9, "bold", COLOR_MUTED);
      advance(12);
      paragraph(note, { size: 10 });
      advance(6);
    }

    // Musterloesung - the full stored answer.
    ensureBlock(40);
    put("Musterloesung:", MARGIN, 9, "bold", COLOR_MUTED);
    advance(12);
    const solution = (item.answerText ?? "").trim();
    if (solution) {
      paragraph(solution, {
        size: 10,
        onBreak: () => {
          put(
            `Frage ${item.orderKey} - Musterloesung (Fortsetzung)`,
            MARGIN,
            9,
            "bold",
            COLOR_MUTED,
          );
          advance(14);
        },
      });
    } else {
      put("Keine Musterloesung gespeichert.", MARGIN, 10, "regular", COLOR_MUTED);
      advance(13);
    }

    advance(12);
    if (idx < data.items.length - 1) {
      ensure(24);
      rule();
      advance(20);
    }
  });

  // -- closing note ---------------------------------------------------------
  ensure(56);
  advance(6);
  rule();
  advance(14);
  paragraph(
    "Bewertungsschluessel: richtig = 100 %, teilweise richtig = 50 %, falsch = 0 % " +
      "der moeglichen Fragebewertung.",
    { size: 8, color: COLOR_MUTED, lineHeight: 11 },
  );
  paragraph("Bestehensgrenze: 50 %.", { size: 8, color: COLOR_MUTED, lineHeight: 11 });
  paragraph(
    "Die Werte in diesem PDF sind die in der App gespeicherten Pruefungsergebnisse.",
    { size: 8, color: COLOR_MUTED, lineHeight: 11 },
  );

  pages.push(ops);

  // Page numbers (added after pagination is known).
  const total = pages.length;
  pages.forEach((pageOps, i) => {
    pageOps.push({
      kind: "text",
      x: PAGE_WIDTH - MARGIN,
      y: MARGIN - 18,
      text: `Seite ${i + 1} von ${total}`,
      size: 8,
      font: "regular",
      color: COLOR_MUTED,
      align: "right",
    });
  });

  return renderPdf(pages, {
    title: `Auswertung muendliche Pruefung - ${data.candidateName}`,
  });
}

/** Suggested download filename (ASCII-safe). */
export function reportFileName(data: ExamReportData): string {
  const safeName = data.candidateName
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const date = data.exam.examDate ?? data.exam.completedAt ?? data.exam.createdAt;
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  return `Muendliche-Pruefung_${safeName || "Pruefling"}_${stamp}.pdf`;
}
