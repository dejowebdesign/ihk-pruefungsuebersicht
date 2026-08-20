// PDF-Auswertung for a completed oral exam.
//
// CRITICAL CONTRACT — no recomputation:
//   The PDF renders ONLY values already persisted on the exam/items by the
//   existing scoring logic (scoring.ts, the 1:1 Excel mirror). It never
//   re-derives percent/total/result, so 55 % in the web UI is byte-for-byte
//   55 % in the PDF (no floating-point drift like 55.00000000001). Numbers
//   come straight from exam.totalPoints / exam.maxPoints / exam.percent /
//   exam.result and per-item item.points / item.weight.
//
// Layout (A4, print-friendly):
//   Kopf:  Titel + §34a-Hinweis, Prüfungsdatum, Prüfling, Prüfer
//   Ergebnis: Gesamtergebnis %, Bestanden/Nicht bestanden, Bestehensgrenze 50 %
//   Tabelle: Themenbereich | Frage | Bewertung | Punkte | Gewichtung
//   je Frage ggf. Prüfernotiz
//   Fuß: Gesamtpunktzahl / max. Punktzahl / Gesamtprozentsatz / Ergebnis
//
// Long questions/notes wrap and flow across page breaks; rows never overlap.

import PDFDocument from "pdfkit";

/** Subset of an OralExam sufficient to render the PDF (matches the Prisma shape). */
export interface OralExamPdfInput {
  id: string;
  candidate: { id: string; name: string };
  examiner: string | null;
  examDate: Date | string | null;
  status: string;
  maxPoints: number;
  totalPoints: number;
  percent: number;
  result: "Bestanden" | "Nicht bestanden" | null;
  items: ReadonlyArray<{
    orderKey: number;
    themeName: string;
    weight: number;
    rating: string | null; // "richtig" | "teilweise richtig" | "falsch" | null
    points: number;
    note: string | null;
    question: { excelId: string; question: string; answer: string | null; source: string | null };
  }>;
}

export const ORAL_PASS_THRESHOLD = 50; // Excel G20

const RATING_LABEL: Record<string, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};

function ratingLabel(rating: string | null): string {
  if (!rating) return "—";
  return RATING_LABEL[rating] ?? rating;
}

/**
 * Render the PDF for a completed oral exam into a Node Buffer.
 * Throws if the exam is not completed (a PDF is only meaningful post-completion).
 *
 * Async because pdfkit emits the encoded bytes via 'data'/'end' events after
 * `doc.end()`, so we await the stream finishing before returning the buffer.
 */
export async function generateExamPdf(exam: OralExamPdfInput): Promise<Buffer> {
  if (exam.status !== "completed") {
    throw new Error("PDF export is only available for completed exams");
  }

  // A4 portrait, 50pt margins (=> 495.28pt content width).
  // compress:false keeps text streams uncompressed so the percent/labels are
  // human-readable in the file (and verifiable in tests). The PDF is still
  // small (a few KB) and prints identically.
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, compress: false });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));

  const margin = 50;
  const contentWidth = doc.page.width - margin * 2; // 495.28
  const bottomLimit = doc.page.height - margin; // 791.89

  let y = margin;

  // ---------- Kopf ----------
  doc.font("Helvetica-Bold").fontSize(18);
  doc.text("Auswertung der mündlichen Prüfung", margin, y, { width: contentWidth });
  y = doc.y + 4;

  doc.font("Helvetica").fontSize(10);
  doc.text("Sachkundeprüfung §34a GewO (Objektiver Personen- und Objektschutz)", margin, y, { width: contentWidth });
  y = doc.y + 18;

  // Prüfungsdatum / Prüfling / Prüfer
  const dateStr = exam.examDate
    ? new Date(exam.examDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";
  doc.font("Helvetica").fontSize(11);
  doc.text(`Prüfungsdatum: ${dateStr}`, margin, y, { width: contentWidth });
  y = doc.y + 2;
  doc.text(`Prüfling: ${exam.candidate.name}`, margin, y, { width: contentWidth });
  y = doc.y + 2;
  doc.text(`Prüfer/in: ${exam.examiner ?? "—"}`, margin, y, { width: contentWidth });
  y = doc.y + 22;

  // ---------- Ergebnis-Block ----------
  doc.font("Helvetica-Bold").fontSize(13);
  doc.text("Gesamtergebnis", margin, y, { width: contentWidth });
  y = doc.y + 6;

  const percentStr = `${Math.round(exam.percent)} %`;
  doc.font("Helvetica-Bold").fontSize(32);
  doc.text(percentStr, margin, y, { width: contentWidth });
  y = doc.y + 6;

  const resultStr = exam.result ?? "—";
  doc.font("Helvetica-Bold").fontSize(14);
  doc.text(
    `Status: ${resultStr}`,
    margin,
    y,
    { width: contentWidth },
  );
  y = doc.y + 2;

  doc.font("Helvetica").fontSize(10);
  doc.text(`Bestehensgrenze: ${ORAL_PASS_THRESHOLD} %`, margin, y, { width: contentWidth });
  y = doc.y + 20;

  // ---------- Detail-Tabelle ----------
  doc.font("Helvetica-Bold").fontSize(13);
  doc.text("Detaillierte Auswertung", margin, y, { width: contentWidth });
  y = doc.y + 10;

  // Column layout (contentWidth = 495.28):
  //   Themenbereich 150 | Frage 205 | Bewertung 60 | Punkte 40 | Gewichtung 40  => 495
  const colTheme = 150;
  const colQuestion = contentWidth - colTheme - 60 - 40 - 40; // 205.28
  const colRating = 60;
  const colPoints = 40;
  const colWeight = 40;
  const xTheme = margin;
  const xQuestion = xTheme + colTheme;
  const xRating = xQuestion + colQuestion;
  const xPoints = xRating + colRating;
  const xWeight = xPoints + colPoints;

  const rowGap = 4;
  const cellPadV = 3;

  function drawHeaderRow() {
    doc.font("Helvetica-Bold").fontSize(9);
    const h = doc.heightOfString("Themenbereich", { width: colTheme, columns: undefined as never }) + cellPadV * 2;
    // background bar
    doc.rect(margin, y, contentWidth, h).fill("#e8e8e8");
    doc.fillColor("#000000");
    doc.text("Themenbereich", xTheme, y + cellPadV, { width: colTheme });
    doc.text("Frage", xQuestion, y + cellPadV, { width: colQuestion });
    doc.text("Bewertung", xRating, y + cellPadV, { width: colRating });
    doc.text("Punkte", xPoints, y + cellPadV, { width: colPoints, align: "right" });
    doc.text("Gewicht.", xWeight, y + cellPadV, { width: colWeight, align: "right" });
    y += h + rowGap;
  }

  drawHeaderRow();

  const items = [...exam.items].sort((a, b) => a.orderKey - b.orderKey);

  for (const it of items) {
    const frageText = it.question.question || "—";
    const themaText = it.themeName;
    const bewertungText = ratingLabel(it.rating);
    const punkteText = String(it.points);
    const gewichtText = String(it.weight);

    // Measure each cell's wrapped height.
    doc.font("Helvetica").fontSize(9);
    const hFrage = doc.heightOfString(frageText, { width: colQuestion });
    const hThema = doc.heightOfString(themaText, { width: colTheme });
    const hBew = doc.heightOfString(bewertungText, { width: colRating });
    const hPunkte = doc.heightOfString(punkteText, { width: colPoints });
    const hGewicht = doc.heightOfString(gewichtText, { width: colWeight });
    let rowH = Math.max(hFrage, hThema, hBew, hPunkte, hGewicht) + cellPadV * 2;

    // Optional note block below the row.
    let noteH = 0;
    if (it.note && it.note.trim().length > 0) {
      doc.font("Helvetica-Oblique").fontSize(8);
      const noteText = `Notiz: ${it.note}`;
      noteH = doc.heightOfString(noteText, { width: colQuestion }) + cellPadV * 2;
      rowH += noteH;
    }

    // Page break if the row (+ note) doesn't fit.
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = margin;
      drawHeaderRow();
    }

    const rowTop = y;
    // Draw the question text (tallest) to set the row baseline.
    doc.font("Helvetica").fontSize(9);
    doc.text(frageText, xQuestion, rowTop + cellPadV, { width: colQuestion });
    doc.text(themaText, xTheme, rowTop + cellPadV, { width: colTheme });
    doc.text(bewertungText, xRating, rowTop + cellPadV, { width: colRating });
    doc.text(punkteText, xPoints, rowTop + cellPadV, { width: colPoints, align: "right" });
    doc.text(gewichtText, xWeight, rowTop + cellPadV, { width: colWeight, align: "right" });

    if (noteH > 0) {
      doc.font("Helvetica-Oblique").fontSize(8);
      doc.fillColor("#444444");
      doc.text(`Notiz: ${it.note}`, xQuestion, rowTop + cellPadV + hFrage + cellPadV, { width: colQuestion });
      doc.fillColor("#000000");
    }

    y = rowTop + rowH + rowGap;
  }

  // ---------- Fuß / Zusammenfassung ----------
  y += 10;
  if (y + 120 > bottomLimit) {
    doc.addPage();
    y = margin;
  }

  doc.font("Helvetica-Bold").fontSize(13);
  doc.text("Zusammenfassung", margin, y, { width: contentWidth });
  y = doc.y + 8;

  doc.font("Helvetica").fontSize(11);
  doc.text(`Gesamtpunktzahl: ${exam.totalPoints}`, margin, y, { width: contentWidth });
  y = doc.y + 2;
  doc.text(`Maximale Punktzahl: ${exam.maxPoints}`, margin, y, { width: contentWidth });
  y = doc.y + 2;
  doc.text(`Gesamtprozentsatz: ${percentStr}`, margin, y, { width: contentWidth });
  y = doc.y + 2;
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text(`Ergebnis: ${resultStr}`, margin, y, { width: contentWidth });
  y = doc.y + 16;

  doc.font("Helvetica").fontSize(8);
  doc.fillColor("#666666");
  doc.text(
    "Erstellt von IHK-Prüfungsübersicht · Dieses Dokument enthält die gespeicherte Auswertung der mündlichen Prüfung.",
    margin,
    y,
    { width: contentWidth },
  );
  doc.fillColor("#000000");

  // Page numbers on every page.
  const range = doc.bufferedPageRange(); // { start, count }
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor("#999999");
    doc.text(
      `Seite ${i - range.start + 1} / ${total}`,
      margin,
      doc.page.height - margin + 14,
      { width: contentWidth, align: "center" },
    );
  }

  doc.end();

  // Await the full stream (data flushed, 'end' emitted) before returning.
  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  return Buffer.concat(chunks);
}
