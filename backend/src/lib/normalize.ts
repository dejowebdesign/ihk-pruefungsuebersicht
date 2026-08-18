// Normalizers turn raw sheet rows into typed, normalized entities.
// Principle: NEVER invent values. Unknown -> null.

import type { SheetJson } from "./types";

/** Convert a gviz cell value to a string, preserving null. */
function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" ? null : s;
}

/** Convert a numeric-ish cell to a string (preserves "3"/"5" etc., null if empty). */
function toNumStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Parse a gviz "Date(y,m,d)" string into an ISO date string, else return raw. */
function parseGvizDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const m = s.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) {
    const [, y, mo, d] = m;
    const mm = String(Number(mo)).padStart(2, "0");
    const dd = String(Number(d)).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  return s || null;
}

/** Indices of the Übersicht columns (0-based), matching the analyzed header layout. */
const OVERVIEW_COL = {
  ID: 0,
  NR: 1,
  KURZFORM: 2,
  OFFIZIELL: 3,
  SKP: 4,
  BUNDESLAND: 5,
  SCHRIFTLICHE_FORM: 6,
  ERGEBNIS_SOFORT: 7,
  GLEICHER_TAG: 8,
  ABSTAND: 9,
  ANZAHL_PRUEFER: 10,
  EINZEL_GRUPPE: 11,
  FALLBEISPIEL: 12,
  KO_FALLBEISPIEL: 13,
  PUNKTESYSTEM: 14,
  VORBEREITUNG: 15,
  NOTIZEN: 16,
  DATENSTAND: 17,
  LETZTE_AKT: 18,
  // cols 19..28 empty
  BEZIRK: 29,
  ADRESSE: 30,
  TELEFON: 31,
  WEBSITE: 32,
  ANSPRECHPARTNER: 33,
  DURCHWAHL: 34,
  EMAIL: 35,
  ROUTE: 36,
} as const;

export interface NormalizedIhk {
  nr: number | null;
  ihkShortName: string;
  officialName: string | null;
  skp: string | null;
  bundesland: string | null;
  writtenForm: string | null;
  writtenResultImmediate: string | null;
  sameDay: string | null;
  intervalWrittenOral: string | null;
  examinerCount: string | null;
  groupFormat: string | null;
  fallbeispiel: string | null;
  koFallbeispiel: string | null;
  punktesystem: string | null;
  vorbereitung: string | null;
  notizen: string | null;
  dataState: string | null;
  lastUpdatedRaw: string | null;
  bezirk: string | null;
  adresse: string | null;
  telefon: string | null;
  website: string | null;
  ansprechpartner: string | null;
  durchwahl: string | null;
  email: string | null;
  routeUrl: string | null;
  sourceRowNumber: number;
}

/** Normalize the "Übersicht" sheet into one IHK location per data row. */
export function normalizeOverview(sheet: SheetJson): NormalizedIhk[] {
  const out: NormalizedIhk[] = [];
  sheet.rows.forEach((row, idx) => {
    const get = (i: number) => (i < row.length ? row[i] : null);
    const shortName = toStr(get(OVERVIEW_COL.KURZFORM));
    if (!shortName) return; // skip fully-empty rows
    out.push({
      nr: toNumStr(get(OVERVIEW_COL.NR)) ? Number(toNumStr(get(OVERVIEW_COL.NR))) : null,
      ihkShortName: shortName,
      officialName: toStr(get(OVERVIEW_COL.OFFIZIELL)),
      skp: toStr(get(OVERVIEW_COL.SKP)),
      bundesland: toStr(get(OVERVIEW_COL.BUNDESLAND)),
      writtenForm: toStr(get(OVERVIEW_COL.SCHRIFTLICHE_FORM)),
      writtenResultImmediate: toStr(get(OVERVIEW_COL.ERGEBNIS_SOFORT)),
      sameDay: toStr(get(OVERVIEW_COL.GLEICHER_TAG)),
      intervalWrittenOral: toStr(get(OVERVIEW_COL.ABSTAND)),
      examinerCount: toNumStr(get(OVERVIEW_COL.ANZAHL_PRUEFER)),
      groupFormat: toStr(get(OVERVIEW_COL.EINZEL_GRUPPE)),
      fallbeispiel: toStr(get(OVERVIEW_COL.FALLBEISPIEL)),
      koFallbeispiel: toStr(get(OVERVIEW_COL.KO_FALLBEISPIEL)),
      punktesystem: toStr(get(OVERVIEW_COL.PUNKTESYSTEM)),
      vorbereitung: toStr(get(OVERVIEW_COL.VORBEREITUNG)),
      notizen: toStr(get(OVERVIEW_COL.NOTIZEN)),
      dataState: toStr(get(OVERVIEW_COL.DATENSTAND)),
      lastUpdatedRaw: parseGvizDate(get(OVERVIEW_COL.LETZTE_AKT)),
      bezirk: toStr(get(OVERVIEW_COL.BEZIRK)),
      adresse: toStr(get(OVERVIEW_COL.ADRESSE)),
      telefon: toStr(get(OVERVIEW_COL.TELEFON)),
      website: toStr(get(OVERVIEW_COL.WEBSITE)),
      ansprechpartner: toStr(get(OVERVIEW_COL.ANSPRECHPARTNER)),
      durchwahl: toStr(get(OVERVIEW_COL.DURCHWAHL)),
      email: toStr(get(OVERVIEW_COL.EMAIL)),
      routeUrl: toStr(get(OVERVIEW_COL.ROUTE)),
      sourceRowNumber: idx + 1, // 1-based
    });
  });
  return out;
}

/** Master_Fragen_Muendlich column indices (0-based). */
const Q_COL = {
  ID: 0,
  KATEGORIE: 1,
  FRAGE: 2,
  ANTWORT: 3,
  RECHTSLEHRE: 4,
  SCHWIERIGKEIT: 5,
  CLUSTER: 6,
  FOLGEFRAGE1: 7,
  FOLGEFRAGE2: 8,
  SPALTE4: 9,
} as const;

export interface NormalizedQuestion {
  masterId: string | null;
  category: string | null;
  question: string;
  answer: string | null;
  legalBasis: string | null;
  difficulty: string | null;
  cluster: string | null;
  followUp1: string | null;
  followUp2: string | null;
  extraCol: string | null;
  sourceRowNumber: number;
}

/** Normalize Master_Fragen_Muendlich into question rows. */
export function normalizeQuestions(sheet: SheetJson): NormalizedQuestion[] {
  const out: NormalizedQuestion[] = [];
  sheet.rows.forEach((row, idx) => {
    const get = (i: number) => (i < row.length ? row[i] : null);
    const frage = toStr(get(Q_COL.FRAGE));
    if (!frage) return; // skip empty rows
    out.push({
      masterId: toNumStr(get(Q_COL.ID)),
      category: toStr(get(Q_COL.KATEGORIE)),
      question: frage,
      answer: toStr(get(Q_COL.ANTWORT)),
      legalBasis: toStr(get(Q_COL.RECHTSLEHRE)),
      difficulty: toNumStr(get(Q_COL.SCHWIERIGKEIT)),
      cluster: toStr(get(Q_COL.CLUSTER)),
      followUp1: toStr(get(Q_COL.FOLGEFRAGE1)),
      followUp2: toStr(get(Q_COL.FOLGEFRAGE2)),
      extraCol: toStr(get(Q_COL.SPALTE4)),
      sourceRowNumber: idx + 1,
    });
  });
  return out;
}

/** Master_TOP_Fallbeispiele column indices (0-based). */
const C_COL = {
  ID: 0,
  KATEGORIE: 1,
  FALLBEISPIEL: 2,
  ANTWORT: 3,
  RECHTSLEHRE: 4,
  SCHWIERIGKEIT: 5,
  CLUSTER: 6,
  FOLGEFRAGE1: 7,
  ANTWORT1: 8,
  FOLGEFRAGE2: 9,
  ANTWORT2: 10,
} as const;

export interface NormalizedCaseExample {
  masterId: string | null;
  category: string | null;
  scenario: string;
  perfectAnswer: string | null;
  legalBasis: string | null;
  difficulty: string | null;
  cluster: string | null;
  followUp1: string | null;
  answer1: string | null;
  followUp2: string | null;
  answer2: string | null;
  sourceRowNumber: number;
}

/** Normalize Master_TOP_Fallbeispiele into case-example rows. */
export function normalizeCaseExamples(sheet: SheetJson): NormalizedCaseExample[] {
  const out: NormalizedCaseExample[] = [];
  sheet.rows.forEach((row, idx) => {
    const get = (i: number) => (i < row.length ? row[i] : null);
    const scenario = toStr(get(C_COL.FALLBEISPIEL));
    if (!scenario) return;
    out.push({
      masterId: toNumStr(get(C_COL.ID)),
      category: toStr(get(C_COL.KATEGORIE)),
      scenario,
      perfectAnswer: toStr(get(C_COL.ANTWORT)),
      legalBasis: toStr(get(C_COL.RECHTSLEHRE)),
      difficulty: toNumStr(get(C_COL.SCHWIERIGKEIT)),
      cluster: toStr(get(C_COL.CLUSTER)),
      followUp1: toStr(get(C_COL.FOLGEFRAGE1)),
      answer1: toStr(get(C_COL.ANTWORT1)),
      followUp2: toStr(get(C_COL.FOLGEFRAGE2)),
      answer2: toStr(get(C_COL.ANTWORT2)),
      sourceRowNumber: idx + 1,
    });
  });
  return out;
}

/**
 * Best-effort semantics for a city IHK register.
 * Layout variant A: field labels in column B (idx 1), values in column C (idx 2).
 * Layout variant B: the same fields may be merged into a header cell — those are
 * NOT derivable and stay null. We only extract fields that appear as discrete rows.
 */
const IHK_SEMANTIC_FIELDS = new Set([
  "Medium",
  "Ergebnis sofort",
  "Gleicher Tag",
  "Abstand schriftlich/mündlich",
  "Prüfung vorhanden",
  "Prüferanzahl",
  "Einzel / Gruppe",
  "Ergebnis bekannt",
  "Hauptschwerpunkte",
  "Bescheinigung",
  "Zertifikat sofort",
  "Zertifikat per Post",
  "Ablauf",
  "Besonderheiten",
  "Eindruck",
  "Letzte Aktualisierung",
]);

export interface IhkSemantic {
  field: string;
  value: string | null;
  sourceRowNumber: number;
}

/** Extract discrete labeled fields from a city IHK register (best-effort). */
export function extractIhkSemantics(sheet: SheetJson): IhkSemantic[] {
  const out: IhkSemantic[] = [];
  sheet.rows.forEach((row, idx) => {
    const label = toStr(row[1]);
    if (!label || !IHK_SEMANTIC_FIELDS.has(label)) return;
    const value = toStr(row[2] ?? row[2]);
    out.push({ field: label, value, sourceRowNumber: idx + 1 });
  });
  return out;
}
