// Snapshot → SQLite initial import.
// Reads the 85 JSON snapshot files, validates, and writes to Prisma via the
// shared persist path (also used by the live gviz importer).
// Fail-safe: validation runs BEFORE any write; on failure, prior data is untouched.

import path from "node:path";
import {
  loadAllSheets,
  loadManifest,
  snapshotDir,
} from "../lib/snapshot-loader";
import { persistImport } from "./persist";

export type { ImportResult } from "./persist";

/**
 * Run the initial snapshot import.
 * @param dir snapshot directory (default: data/snapshot)
 */
export async function runInitialImport(dir = snapshotDir()) {
  const sheets = await loadAllSheets(dir);
  const manifest = await loadManifest(dir);
  return persistImport(sheets, {
    source: "snapshot",
    sourceRef: path.basename(dir),
    snapshotVersion: `snapshot-${sheets.length}sheets-${manifest.totalSheets}total`,
  });
}
