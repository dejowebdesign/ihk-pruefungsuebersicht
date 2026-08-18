import path from "node:path";
import fs from "node:fs/promises";
import type { SheetJson, Manifest } from "./types";

/** Resolve the snapshot directory relative to the backend project root. */
export function snapshotDir(): string {
  // backend/src/lib -> ../../data/snapshot
  return path.resolve(__dirname, "../../../data/snapshot");
}

/** Load the manifest from the snapshot directory. */
export async function loadManifest(dir = snapshotDir()): Promise<Manifest> {
  const p = path.join(dir, "_manifest.json");
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw) as Manifest;
}

/** Safe filename for a sheet name (mirrors extract_sheets.py). */
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9äöüÄÖÜß._-]/g, "_") + ".json";
}

/** Load a single sheet JSON by its original register name. */
export async function loadSheet(name: string, dir = snapshotDir()): Promise<SheetJson> {
  const p = path.join(dir, safeFileName(name));
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw) as SheetJson;
}

/** Load all sheets in manifest order. */
export async function loadAllSheets(dir = snapshotDir()): Promise<SheetJson[]> {
  const manifest = await loadManifest(dir);
  const out: SheetJson[] = [];
  for (const e of manifest.sheets) {
    out.push(await loadSheet(e.sheetName, dir));
  }
  return out;
}
