import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadAllSheets } from "../src/lib/snapshot-loader";
import { persistImport } from "../src/importer/persist";
import { makeIsolatedDb } from "./helpers/db";
import type { PrismaClient } from "@prisma/client";

let client: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ client, cleanup } = await makeIsolatedDb());
}, 180_000);

afterAll(async () => {
  await cleanup();
});

function cloneSheets<T>(s: T[]): T[] {
  return JSON.parse(JSON.stringify(s));
}

describe("fail-safe / rollback", () => {
  it("establishes a successful baseline first", async () => {
    const sheets = await loadAllSheets();
    const r = await persistImport(cloneSheets(sheets), {
      source: "snapshot",
      sourceRef: "baseline",
      db: client,
    });
    expect(r.status).toBe("SUCCESS");
    expect(r.ihkLocations).toBe(82);
  });

  it("refuses a corrupted import (missing Übersicht) — old data stays intact", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    // Remove the critical Übersicht sheet.
    const filtered = sheets.filter((s) => s.sheetName !== "Übersicht");
    const r = await persistImport(filtered, {
      source: "snapshot",
      sourceRef: "corrupted-no-overview",
      db: client,
    });
    expect(r.status).toBe("FAILED");
    // No ImportRun should have been created (validation ran before any write).
    expect(r.importRunId).toBeNull();

    // Previous baseline data must still be intact.
    const ihkCount = await client.ihkLocation.count();
    expect(ihkCount).toBe(82);
    const successRuns = await client.importRun.findMany({ where: { status: "SUCCESS" } });
    expect(successRuns).toHaveLength(1); // only the baseline
  });

  it("refuses an import with implausibly few sheets — old data intact", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const tiny = sheets.slice(0, 5);
    const r = await persistImport(tiny, {
      source: "snapshot",
      sourceRef: "too-few",
      db: client,
    });
    expect(r.status).toBe("FAILED");
    const ihkCount = await client.ihkLocation.count();
    expect(ihkCount).toBe(82); // untouched
  });

  it("refuses an import with an empty Übersicht — old data intact", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    const emptyOverview = { ...overview, rows: [] };
    const replaced = sheets.map((s) => (s.sheetName === "Übersicht" ? emptyOverview : s));
    const r = await persistImport(replaced, {
      source: "snapshot",
      sourceRef: "empty-overview",
      db: client,
    });
    expect(r.status).toBe("FAILED");
    const ihkCount = await client.ihkLocation.count();
    expect(ihkCount).toBe(82);
  });
});
