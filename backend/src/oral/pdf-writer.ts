// Minimal PDF writer — just enough for a paginated, table-based report.
//
// Deliberately dependency-free: the app only needs Latin-1 text on A4 pages,
// which is a few hundred lines of PDF 1.4 rather than a font-embedding library.
// Text uses the built-in Helvetica / Helvetica-Bold with WinAnsiEncoding, so
// German umlauts render without shipping a font file.

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;

// Helvetica AFM widths (units/1000) for ASCII 32..126. Used only for wrapping
// and right-alignment; approximate metrics are visually indistinguishable here.
const WIDTHS_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const WIDTHS_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Widths for the non-ASCII characters that actually occur in German text.
const WIDTHS_EXTRA: Record<number, number> = {
  0xa7: 556, // §
  0xb0: 400, // °
  0xc4: 667, // Ä
  0xd6: 778, // Ö
  0xdc: 722, // Ü
  0xdf: 611, // ß
  0xe4: 556, // ä
  0xf6: 556, // ö
  0xfc: 556, // ü
};

export type PdfFont = "regular" | "bold";

/** Unicode → WinAnsi(CP1252) byte. Returns null when unrepresentable. */
function toWinAnsi(code: number): number | null {
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code; // Latin-1 half maps 1:1
  const cp1252: Record<number, number> = {
    0x20ac: 0x80, 0x201a: 0x82, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99, 0x2039: 0x8b,
    0x203a: 0x9b, 0x00a0: 0x20,
  };
  return cp1252[code] ?? null;
}

/** Fold characters that have no WinAnsi equivalent into readable ASCII. */
const FOLD: Record<string, string> = {
  "\u2713": "x", "\u2714": "x", "\u2705": "x", "\u2717": "-", "\u2718": "-",
  "\u2264": "<=", "\u2265": ">=", "\u2192": "->", "\u2190": "<-",
  "\u00b7": "-", "\u2022": "-", "\u00d7": "x", "\u201e": '"', "\u201c": '"',
  "\u201d": '"', "\u2018": "'", "\u2019": "'", "\u2026": "...", "\u2013": "-",
  "\u2014": "-", "\t": " ", "\r": " ", "\n": " ",
};

/** Convert a JS string to WinAnsi bytes (as a number array). */
export function toWinAnsiBytes(input: string): number[] {
  const out: number[] = [];
  for (const ch of input) {
    const direct = toWinAnsi(ch.codePointAt(0)!);
    if (direct !== null) {
      out.push(direct);
      continue;
    }
    const folded = FOLD[ch] ?? "?";
    for (const f of folded) {
      const b = toWinAnsi(f.codePointAt(0)!);
      out.push(b === null ? 0x3f : b); // '?'
    }
  }
  return out;
}

/** Rendered width of a string in points. */
export function textWidth(text: string, size: number, font: PdfFont): number {
  const table = font === "bold" ? WIDTHS_BOLD : WIDTHS_REGULAR;
  let total = 0;
  for (const b of toWinAnsiBytes(text)) {
    if (b >= 32 && b <= 126) total += table[b - 32];
    else total += WIDTHS_EXTRA[b] ?? 556;
  }
  return (total / 1000) * size;
}

/** Greedy word wrap to `maxWidth` points. Always returns at least one line. */
export function wrapText(text: string, size: number, font: PdfFont, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (textWidth(candidate, size, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    // A single word longer than the column: hard-split on characters.
    if (textWidth(word, size, font) > maxWidth) {
      let chunk = "";
      for (const ch of word) {
        if (textWidth(chunk + ch, size, font) > maxWidth && chunk !== "") {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Escape a string as a PDF literal string with octal escapes for non-ASCII. */
function pdfString(text: string): string {
  let out = "(";
  for (const b of toWinAnsiBytes(text)) {
    if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b === 0x5c) out += "\\\\";
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
}

export interface TextOp {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  font: PdfFont;
  /** 0xRRGGBB; undefined = black. */
  color?: number;
  /** right-align the text so it ends at x. */
  align?: "left" | "right";
}

export interface RectOp {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0xRRGGBB fill colour, or "stroke" for a hairline border. */
  fill?: number;
  stroke?: boolean;
}

export interface LineOp {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: number;
}

export type PageOp = TextOp | RectOp | LineOp;

export const PDF_METRICS = { PAGE_WIDTH, PAGE_HEIGHT, MARGIN: 48 };

/** Serialize pages of ops into a PDF 1.4 document. */
export function renderPdf(pages: PageOp[][], opts: { title: string; creationDate?: Date }): Buffer {
  const objects: string[] = [];
  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length; // object number = index + 1
  };

  // Reserve object numbers up front (1 = Catalog, 2 = Pages, 3 = F1, 4 = F2).
  addObject(""); // 1 catalog (filled in later)
  addObject(""); // 2 pages (filled in later)
  const fontRegular = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBold = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const pageObjectNumbers: number[] = [];
  for (const ops of pages) {
    const content = serializeOps(ops);
    const stream = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
    const contentRef = addObject(stream);
    const pageRef = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${contentRef} 0 R >>`,
    );
    pageObjectNumbers.push(pageRef);
  }

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] =
    `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers
      .map((n) => `${n} 0 R`)
      .join(" ")}] >>`;

  const infoRef = addObject(
    `<< /Title ${pdfString(opts.title)} /Producer ${pdfString("IHK Pruefungsuebersicht")} ` +
      `/CreationDate ${pdfString(formatPdfDate(opts.creationDate ?? new Date()))} >>`,
  );

  // Assemble the file, tracking byte offsets for the xref table.
  const header = "%PDF-1.4\n%\xe4\xf6\xfc\xdf\n";
  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

function formatPdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function serializeOps(ops: PageOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.kind === "text") {
      const w = textWidth(op.text, op.size, op.font);
      const x = op.align === "right" ? op.x - w : op.x;
      const color = op.color ?? 0x000000;
      parts.push(
        `q ${rgb(color)} rg BT /${op.font === "bold" ? "F2" : "F1"} ${op.size} Tf ` +
          `1 0 0 1 ${x.toFixed(2)} ${op.y.toFixed(2)} Tm ${pdfString(op.text)} Tj ET Q`,
      );
    } else if (op.kind === "rect") {
      if (op.fill !== undefined) {
        parts.push(
          `q ${rgb(op.fill)} rg ${op.x.toFixed(2)} ${op.y.toFixed(2)} ${op.width.toFixed(
            2,
          )} ${op.height.toFixed(2)} re f Q`,
        );
      }
      if (op.stroke) {
        parts.push(
          `q 0.75 G 0.5 w ${op.x.toFixed(2)} ${op.y.toFixed(2)} ${op.width.toFixed(
            2,
          )} ${op.height.toFixed(2)} re S Q`,
        );
      }
    } else {
      parts.push(
        `q ${rgb(op.color ?? 0xd0d0d0)} RG 0.5 w ${op.x1.toFixed(2)} ${op.y1.toFixed(
          2,
        )} m ${op.x2.toFixed(2)} ${op.y2.toFixed(2)} l S Q`,
      );
    }
  }
  return parts.join("\n");
}

function rgb(value: number): string {
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}
