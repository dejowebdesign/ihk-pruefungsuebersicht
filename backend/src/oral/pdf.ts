// PDF report for a completed oral exam.
//
// The report is a pure RENDERER of already-persisted values: it reads the
// cached OralExam fields (maxPoints / totalPoints / percent / result) and the
// stored per-question rating / points / weight snapshots. It never re-runs the
// scoring logic, so the PDF can never disagree with what the app displays —
// including for historical exams whose weights were snapshotted under an older
// Themenbereich layout.

import type { PrismaClient } from "@prisma/client";
import { renderPdf, wrapText, PDF_METRICS, type PageOp } from "./pdf-writer";

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

const RATING_LABEL: Record<string, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};

export interface ExamReportData {
  exam: {
    id: string;
    status: string;
    examDate: Date | null;
    examiner: string | null;
    completedAt: Date | null;
    maxPoints: number;
    totalPoints: number;
    percent: number;
    result: string | null;
    createdAt: Date;
  };
  candidateName: string;
  items: Array<{
    orderKey: number;
    themeName: string;
    weight: number;
    rating: string | null;
    points: number;
    note: string | null;
    excelId: string;
  }>;
}

/** Load everything the report needs. Returns null for an unknown exam. */
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
        include: { question: { select: { excelId: true } } },
      },
    },
  });
  if (!exam) return null;

  return {
    exam: {
      id: exam.id,
      status: exam.status,
      examDate: exam.examDate,
      examiner: exam.examiner,
      completedAt: exam.completedAt,
      maxPoints: exam.maxPoints,
      totalPoints: exam.totalPoints,
      percent: exam.percent,
      result: exam.result,
      createdAt: exam.createdAt,
    },
    candidateName: exam.candidate.name,
    items: exam.items.map((i) => ({
      orderKey: i.orderKey,
      themeName: i.themeName,
      weight: i.weight,
      rating: i.rating,
      points: i.points,
      note: i.note,
      excelId: i.question.excelId,
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

  const text = (
    value: string,
    x: number,
    size: number,
    font: "regular" | "bold" = "regular",
    color = COLOR_TEXT,
    align: "left" | "right" = "left",
  ) => {
    ops.push({ kind: "text", x, y, text: value, size, font, color, align });
  };

  const gap = (n: number) => {
    y -= n;
  };

  const pageBreakIfNeeded = (needed: number) => {
    if (y - needed < MARGIN + 40) newPage();
  };

  // ── header ───────────────────────────────────────────────────────────────
  text("IHK Pruefungsuebersicht", MARGIN, 9, "bold", COLOR_MUTED);
  gap(14);
  text("Auswertung der muendlichen Pruefung (§ 34a)", MARGIN, 17, "bold", COLOR_PRIMARY);
  gap(6);
  ops.push({
    kind: "line",
    x1: MARGIN,
    y1: y,
    x2: PAGE_WIDTH - MARGIN,
    y2: y,
    color: COLOR_BORDER,
  });
  gap(22);

  // ── exam metadata ────────────────────────────────────────────────────────
  const meta: Array<[string, string]> = [
    ["Pruefling", data.candidateName],
    ["Pruefer/in", data.exam.examiner || "-"],
    ["Pruefungsdatum", fmtDate(data.exam.examDate)],
    ["Abgeschlossen am", fmtDateTime(data.exam.completedAt)],
    ["Status", data.exam.status === "completed" ? "Abgeschlossen" : data.exam.status],
    ["Pruefungs-ID", data.exam.id],
  ];
  const labelWidth = 110;
  for (const [label, value] of meta) {
    text(label, MARGIN, 10, "bold", COLOR_MUTED);
    ops.push({ kind: "text", x: MARGIN + labelWidth, y, text: value, size: 10, font: "regular" });
    gap(15);
  }
  gap(10);

  // ── result box ───────────────────────────────────────────────────────────
  // Every text is placed from the box TOP with an explicit baseline offset.
  // A baseline is the text's BOTTOM edge, so the visible glyphs extend roughly
  // 0.72 * size ABOVE it: a label placed at the box top would be drawn outside
  // the box, and two labels sharing one baseline would overprint each other.
  // The box interior is [boxTop - boxHeight, boxTop], so each baseline must
  // stay below -0.72 * size and above -(boxHeight - 0.24 * size).
  const percent = Math.round(data.exam.percent);
  const passed = data.exam.result === "Bestanden";
  const boxHeight = 64;
  const boxTop = y;
  const LABEL_Y = boxTop - 15; // "Gesamtergebnis", top-left (ascent ends at -7.8)
  const POINTS_Y = boxTop - 31; // "<total> von <max> Punkten", below the label
  const PERCENT_Y = boxTop - 34; // large percent, right side
  const RESULT_Y = boxTop - 52; // "Bestanden" / "Nicht bestanden", right, below
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
    y: LABEL_Y,
    text: "Gesamtergebnis",
    size: 10,
    font: "bold",
    color: COLOR_MUTED,
  });
  ops.push({
    kind: "text",
    x: MARGIN + 16,
    y: POINTS_Y,
    text: `${data.exam.totalPoints} von ${data.exam.maxPoints} Punkten`,
    size: 11,
    font: "regular",
    color: COLOR_TEXT,
  });
  ops.push({
    kind: "text",
    x: PAGE_WIDTH - MARGIN - 16,
    y: PERCENT_Y,
    text: `${percent} %`,
    size: 26,
    font: "bold",
    color: passed ? COLOR_PASS : COLOR_FAIL,
    align: "right",
  });
  ops.push({
    kind: "text",
    x: PAGE_WIDTH - MARGIN - 16,
    y: RESULT_Y,
    text: data.exam.result ?? "-",
    size: 12,
    font: "bold",
    color: passed ? COLOR_PASS : COLOR_FAIL,
    align: "right",
  });
  y = boxTop - boxHeight - 24;

  // ── per-question table ───────────────────────────────────────────────────
  // Column layout: #, Themenbereich, Frage-ID, Bewertung, Gewicht, Punkte.
  // A separate note block per question follows the table when present.
  const cols = [
    { key: "orderKey", label: "#", width: 24, align: "right" as const },
    { key: "themeName", label: "Themenbereich", width: 170, align: "left" as const },
    { key: "excelId", label: "Frage-ID", width: 110, align: "left" as const },
    { key: "rating", label: "Bewertung", width: 95, align: "left" as const },
    { key: "weight", label: "Gewicht", width: 48, align: "right" as const },
    { key: "points", label: "Punkte", width: 45, align: "right" as const },
  ];
  const colWidths = cols.reduce((s, c) => s + c.width, 0);
  const tableX = MARGIN;
  const rowHeight = 17;
  const headHeight = 19;

  const drawTableHeader = () => {
    ops.push({
      kind: "rect",
      x: tableX,
      y: y - headHeight,
      width: colWidths,
      height: headHeight,
      fill: COLOR_HEAD_BG,
    });
    let x = tableX;
    for (const c of cols) {
      const tx = c.align === "right" ? x + c.width - 5 : x + 5;
      ops.push({
        kind: "text",
        x: tx,
        y: y - 13,
        text: c.label,
        size: 9,
        font: "bold",
        color: COLOR_MUTED,
        align: c.align,
      });
      x += c.width;
    }
    y -= headHeight;
  };

  const drawRow = (values: string[], shaded: boolean) => {
    // Wrap every cell to its column width; the row grows to fit the tallest
    // cell so long Themenbereich labels never bleed into the next column.
    const wrapped = values.map((v, i) =>
      wrapText(v, 9, "regular", cols[i].width - 10).slice(0, 3),
    );
    const lineCount = Math.max(...wrapped.map((w) => w.length));
    const height = Math.max(rowHeight, lineCount * 11 + 6);

    if (shaded) {
      ops.push({
        kind: "rect",
        x: tableX,
        y: y - height,
        width: colWidths,
        height,
        fill: COLOR_ROW_BG,
      });
    }
    let x = tableX;
    wrapped.forEach((lines, i) => {
      const c = cols[i];
      lines.forEach((line, li) => {
        const tx = c.align === "right" ? x + c.width - 5 : x + 5;
        ops.push({
          kind: "text",
          x: tx,
          y: y - 12 - li * 11,
          text: line,
          size: 9,
          font: "regular",
          color: COLOR_TEXT,
          align: c.align,
        });
      });
      x += c.width;
    });
    ops.push({
      kind: "line",
      x1: tableX,
      y1: y - height,
      x2: tableX + colWidths,
      y2: y - height,
      color: COLOR_BORDER,
    });
    y -= height;
  };

  drawTableHeader();
  data.items.forEach((item, idx) => {
    pageBreakIfNeeded(rowHeight + 4);
    if (y === PAGE_HEIGHT - MARGIN) drawTableHeader();
    drawRow(
      [
        String(item.orderKey),
        item.themeName,
        item.excelId,
        item.rating ? (RATING_LABEL[item.rating] ?? item.rating) : "nicht bewertet",
        String(item.weight),
        String(item.points),
      ],
      idx % 2 === 1,
    );
  });

  // Sum row.
  pageBreakIfNeeded(rowHeight + 4);
  if (y === PAGE_HEIGHT - MARGIN) drawTableHeader();
  ops.push({
    kind: "rect",
    x: tableX,
    y: y - rowHeight,
    width: colWidths,
    height: rowHeight,
    fill: COLOR_HEAD_BG,
  });
  ops.push({
    kind: "text",
    x: tableX + 5,
    y: y - 12,
    text: "Summe",
    size: 9,
    font: "bold",
    color: COLOR_TEXT,
  });
  ops.push({
    kind: "text",
    x: tableX + colWidths - 5,
    y: y - 12,
    text: `${data.exam.totalPoints} / ${data.exam.maxPoints}`,
    size: 9,
    font: "bold",
    color: COLOR_TEXT,
    align: "right",
  });
  y -= rowHeight + 20;

  // ── examiner notes ───────────────────────────────────────────────────────
  const noted = data.items.filter((i) => (i.note ?? "").trim() !== "");
  if (noted.length > 0) {
    pageBreakIfNeeded(30);
    text("Pruefernotizen", MARGIN, 12, "bold", COLOR_TEXT);
    gap(16);
    for (const item of noted) {
      const lines = wrapText(
        `${item.orderKey}. ${item.themeName} (${item.excelId}): ${item.note}`,
        9,
        "regular",
        CONTENT_WIDTH,
      );
      pageBreakIfNeeded(lines.length * 12 + 8);
      for (const line of lines) {
        text(line, MARGIN, 9, "regular", COLOR_TEXT);
        gap(12);
      }
      gap(4);
    }
    gap(8);
  }

  // ── footer note ──────────────────────────────────────────────────────────
  pageBreakIfNeeded(40);
  ops.push({
    kind: "line",
    x1: MARGIN,
    y1: y,
    x2: PAGE_WIDTH - MARGIN,
    y2: y,
    color: COLOR_BORDER,
  });
  gap(14);
  text(
    "Bewertungsschluessel: richtig = volle Punkte, teilweise richtig = halbe Punkte, falsch = 0 Punkte.",
    MARGIN,
    8,
    "regular",
    COLOR_MUTED,
  );
  gap(11);
  text(
    `Bestehensgrenze: 50 von ${data.exam.maxPoints} Punkten. Die Werte in diesem PDF sind die in der App gespeicherten Pruefungsergebnisse.`,
    MARGIN,
    8,
    "regular",
    COLOR_MUTED,
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
