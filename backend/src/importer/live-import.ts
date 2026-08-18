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
  const sheetId = opts.sheetId ?? DEFAULT_SHEET_ID;
  const sheets = await fetchAllSheets(opts);
  return persistImport(sheets, {
    source: "google-gviz",
    sourceRef: sheetId,
    snapshotVersion: opts.snapshotVersion ?? `gviz-${new Date().toISOString()}`,
  });
}
