// Shared types for the IHK import platform.

/** A single sheet extracted from Google Sheets (gviz) or loaded from a snapshot. */
export interface SheetJson {
  sheetName: string;
  gid: string;
  sheetId: string; // google spreadsheet id (same for all sheets)
  source: string; // gviz url or snapshot path
  cols: unknown[]; // raw gviz cols (preserved)
  headers: (string | null)[];
  rows: (unknown | null)[][];
  numRows: number;
  numCols: number;
  parsedNumHeaders: number | null;
  warnings: string | string[] | null;
  errors: string | string[] | null;
}

export interface ManifestEntry {
  sheetName: string;
  gid: string;
  file: string;
  rows: number;
  cols: number;
  ok: boolean;
}

export interface Manifest {
  sheetId: string;
  totalSheets: number;
  extracted: number;
  failed: number;
  sheets: ManifestEntry[];
  failures: unknown[];
}

export type SheetType =
  | "OVERVIEW"
  | "MASTER_QUESTIONS"
  | "MASTER_CASES"
  | "FREQUENT_ERRORS"
  | "IHK"
  | "UNKNOWN";

export type ImportStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

/** Result of validating a snapshot before import. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  sheetCount: number;
  ihkSheetCount: number;
  hasOverview: boolean;
  hasMasterQuestions: boolean;
  hasMasterCases: boolean;
  hasFrequentErrors: boolean;
}
