// Live importer: fetch all sheets from Google Sheets via gviz/tq, validate, persist.
// Read-only against the spreadsheet; never modifies the source.

import {
  DEFAULT_SHEET_ID,
  fetchAllSheets,
  type GvizFetchOptions,
} from "./gviz-client";
import { persistImport } from "./persist";

export interface LiveImportOptions extends GvizFetchOptions {
  sheetId?: string;
  requestDelayMs?: number;
  snapshotVersion?: string;
}

/** Fetch all sheets via gviz and persist them as a new ImportRun. */
export async function runLiveImport(opts: LiveImportOptions = {}) {
  // Allow GOOGLE_SHEET_ID to override the built-in default (the compose file
  // declares it). An explicit opts.sheetId still wins (used by tests/ad-hoc).
  const sheetId = opts.sheetId ?? process.env.GOOGLE_SHEET_ID ?? DEFAULT_SHEET_ID;
  const sheets = await fetchAllSheets({ ...opts, sheetId });
  return persistImport(sheets, {
    source: "google-gviz",
    sourceRef: sheetId,
    snapshotVersion: opts.snapshotVersion ?? `gviz-${new Date().toISOString()}`,
  });
}
