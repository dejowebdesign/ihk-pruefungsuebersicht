// Google Visualization API (gviz/tq) live importer.
// Mirrors the read-only, no-auth method validated in PHASE 1 / extract_sheets.py.
// Never writes to the spreadsheet; only fetches public preview data.

import { SheetJson } from "./types";

export const DEFAULT_SHEET_ID = "1jDFsBoQyzReOv-AxFAgrhAZkdimwp-oj7UT56pqf0Wk";
export const PREVIEW_URL = (sheetId: string) =>
  `https://docs.google.com/spreadsheets/u/0/d/${sheetId}/preview?pli=1&usp=embed_googleplus`;
export const GVIZ_URL = (sheetId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;

export interface GvizSheetRef {
  name: string;
  gid: string;
}

export interface GvizFetchOptions {
  sheetId?: string;
  requestDelayMs?: number;
  fetchImpl?: typeof fetch; // injectable for tests
  signal?: AbortSignal;
}

/** HTTP GET with a basic User-Agent (matches the Python extractor). */
async function httpGet(url: string, fetchImpl: typeof fetch, timeoutMs = 45_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (ihk-pruefungsuebersicht-importer)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover all sheets (name + gid) from the public preview's JS `items.push`.
 * Robust regex mirrors extract_sheets.py; handles \/, \xNN, \uNNNN escapes.
 */
export async function discoverSheets(opts: GvizFetchOptions = {}): Promise<GvizSheetRef[]> {
  const sheetId = opts.sheetId ?? DEFAULT_SHEET_ID;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const html = await httpGet(PREVIEW_URL(sheetId), fetchImpl);

  // Match: items.push({name: "...", pageUrl: "...", gid: "..."})
  const re =
    /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"(?:[^"\\]|\\.)*",\s*gid:\s*"(\d+)"/g;
  const out: GvizSheetRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ name: decodeGvizString(m[1]), gid: m[2] });
  }
  if (out.length === 0) {
    throw new Error("Could not parse any sheets from preview HTML (format changed?)");
  }
  return out;
}

/** Decode gviz JS-string escapes (\/, \xNN, \uNNNN). */
function decodeGvizString(s: string): string {
  let out = s.replace(/\\\//g, "/");
  out = out.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return out;
}

interface GvizCell {
  v: unknown;
  f?: string | null;
}

interface GvizCol {
  id?: string;
  label?: string | null;
  type?: string;
}

interface GvizResponse {
  status: string;
  table: {
    cols: GvizCol[];
    rows: { c: (GvizCell | null)[] }[];
    parsedNumHeaders?: number | null;
    warnings?: unknown;
    errors?: unknown;
  };
}

/** Parse a gviz `google.visualization.Query.setResponse(...)` payload. */
export function parseGvizPayload(raw: string): GvizResponse {
  const m = raw.match(/google\.visualization\.Query\.setResponse\((.*)\);\s*$/s);
  if (!m) {
    throw new Error("Could not parse gviz response (setResponse marker missing)");
  }
  return JSON.parse(m[1]) as GvizResponse;
}

/** Convert a gviz cell to a plain value (formtted `f` preferred when present). */
function cellValue(c: GvizCell | null): unknown {
  if (c === null || c === undefined) return null;
  // Prefer formatted value `f` for display fidelity, fall back to `v`.
  if (c.f !== undefined && c.f !== null && c.f !== "") return c.f;
  return c.v ?? null;
}

/**
 * Fetch one sheet by gid and normalize it into the shared SheetJson shape
 * (the same shape the snapshot loader produces), so downstream parsers are reused.
 */
export async function fetchSheet(
  ref: GvizSheetRef,
  opts: GvizFetchOptions = {},
): Promise<SheetJson> {
  const sheetId = opts.sheetId ?? DEFAULT_SHEET_ID;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const raw = await httpGet(GVIZ_URL(sheetId, ref.gid), fetchImpl);
  const resp = parseGvizPayload(raw);

  if (resp.status !== "ok") {
    throw new Error(`gviz status not ok: ${resp.status}`);
  }
  const cols = resp.table.cols ?? [];
  const headers: (string | null)[] = cols.map((c) => c.label ?? null);
  const rows: (unknown | null)[][] = (resp.table.rows ?? []).map((r) => {
    const cells = r.c ?? [];
    return cols.map((_, i) => cellValue(cells[i] ?? null));
  });

  return {
    sheetName: ref.name,
    gid: ref.gid,
    sheetId,
    source: GVIZ_URL(sheetId, ref.gid),
    cols: cols as unknown[],
    headers,
    rows,
    numRows: rows.length,
    numCols: headers.length,
    parsedNumHeaders: resp.table.parsedNumHeaders ?? null,
    warnings: resp.table.warnings ? JSON.stringify(resp.table.warnings) : null,
    errors: resp.table.errors ? JSON.stringify(resp.table.errors) : null,
  };
}

/**
 * Fetch all discovered sheets in order, with a configurable delay between requests
 * (rate-limit friendliness, mirrors extract_sheets.py's 0.4s delay).
 */
export async function fetchAllSheets(
  opts: GvizFetchOptions = {},
): Promise<SheetJson[]> {
  const refs = await discoverSheets(opts);
  const delay = opts.requestDelayMs ?? 400;
  const out: SheetJson[] = [];
  for (let i = 0; i < refs.length; i++) {
    const sheet = await fetchSheet(refs[i], opts);
    out.push(sheet);
    if (i < refs.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
