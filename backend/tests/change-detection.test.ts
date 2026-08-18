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

// Helper: deep-clone sheets so mutations don't leak between runs.
function cloneSheets<T>(sheets: T[]): T[] {
  return JSON.parse(JSON.stringify(sheets));
}

describe("change detection", () => {
  it("first import produces no changes (no previous run)", async () => {
    const sheets = await loadAllSheets();
    const r1 = await persistImport(cloneSheets(sheets), {
      source: "snapshot",
      sourceRef: "test-baseline",
      db: client,
    });
    expect(r1.status).toBe("SUCCESS");
    expect(r1.changeCount).toBe(0); // no previous run to compare against
  });

  it("second identical import produces zero changes", async () => {
    const sheets = await loadAllSheets();
    const r2 = await persistImport(cloneSheets(sheets), {
      source: "snapshot",
      sourceRef: "test-identical",
      db: client,
    });
    expect(r2.status).toBe("SUCCESS");
    expect(r2.changeCount).toBe(0);
  });

  it("detects a changed IHK location field", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    // Mutate Aachen's bundesland (col 5).
    const aachenRow = overview.rows.find((r) => r[2] === "Aachen")!;
    const original = aachenRow[5];
    aachenRow[5] = "Berlin"; // changed from NRW
    const r = await persistImport(sheets, {
      source: "snapshot",
      sourceRef: "test-changed",
      db: client,
    });
    expect(r.status).toBe("SUCCESS");
    expect(r.changeCount).toBeGreaterThan(0);
    const rec = await client.changeRecord.findFirst({
      where: { field: "bundesland", newValue: "Berlin" },
    });
    expect(rec).toBeTruthy();
    expect(rec?.oldValue).toBe(String(original));
    // restore for subsequent tests
    aachenRow[5] = original;
  });

  it("detects a changed question field", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const qSheet = sheets.find((s) => s.sheetName === "Master_Fragen_Muendlich")!;
    const firstRow = qSheet.rows[0];
    const original = firstRow[2];
    firstRow[2] = "Was ist Recht? (geändert)";
    const r = await persistImport(sheets, {
      source: "snapshot",
      sourceRef: "test-q-change",
      db: client,
    });
    expect(r.changeCount).toBeGreaterThan(0);
    const rec = await client.changeRecord.findFirst({
      where: { field: "question", newValue: "Was ist Recht? (geändert)" },
    });
    expect(rec).toBeTruthy();
    expect(rec?.oldValue).toBe(String(original));
    firstRow[2] = original;
  });

  it("detects an added IHK (new short name)", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    // Append a new IHK row (Nr 81, short name "Teststadt").
    const newRow = Array(37).fill(null);
    newRow[1] = 81;
    newRow[2] = "Teststadt";
    newRow[3] = "Test-IHK";
    newRow[5] = "Testland";
    overview.rows.push(newRow);
    const r = await persistImport(sheets, {
      source: "snapshot",
      sourceRef: "test-added",
      db: client,
    });
    expect(r.ihkLocations).toBe(83);
    const added = await client.changeRecord.findFirst({
      where: { field: "__added__", newValue: "Teststadt" },
    });
    expect(added).toBeTruthy();
    // remove the appended row again for cleanliness
    overview.rows.pop();
  });

  it("detects a removed IHK", async () => {
    const sheets = cloneSheets(await loadAllSheets());
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    // Remove the last IHK row.
    const removed = overview.rows.pop();
    const removedName = removed?.[2];
    const r = await persistImport(sheets, {
      source: "snapshot",
      sourceRef: "test-removed",
      db: client,
    });
    expect(r.ihkLocations).toBe(81);
    const rec = await client.changeRecord.findFirst({
      where: { field: "__removed__", oldValue: String(removedName) },
    });
    expect(rec).toBeTruthy();
  });
});
