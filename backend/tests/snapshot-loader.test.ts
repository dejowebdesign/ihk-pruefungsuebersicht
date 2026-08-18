import { describe, it, expect } from "vitest";
import { loadAllSheets, loadManifest, loadSheet, safeFileName } from "../src/lib/snapshot-loader";

describe("snapshot loader", () => {
  it("loads the manifest with 85 sheets", async () => {
    const m = await loadManifest();
    expect(m.totalSheets).toBe(85);
    expect(m.extracted).toBe(85);
    expect(m.failed).toBe(0);
    expect(m.sheets).toHaveLength(85);
  });

  it("loads all 85 sheets in manifest order", async () => {
    const sheets = await loadAllSheets();
    expect(sheets).toHaveLength(85);
    // Order must follow the manifest exactly.
    const m = await loadManifest();
    expect(sheets.map((s) => s.sheetName)).toEqual(m.sheets.map((s) => s.sheetName));
  });

  it("preserves original register names incl. Umlauts", async () => {
    const sheets = await loadAllSheets();
    const names = sheets.map((s) => s.sheetName);
    expect(names).toContain("Übersicht");
    expect(names).toContain("Häufige_Fehler");
    expect(names).toContain("Düsseldorf");
    expect(names).toContain("München");
    expect(names).toContain("Würzburg");
  });

  it("safeFileName maps '/' to '_'", () => {
    expect(safeFileName("Bremen/Bremerhaven")).toBe("Bremen_Bremerhaven.json");
    expect(safeFileName("Emden/Ostfriesland")).toBe("Emden_Ostfriesland.json");
  });

  it("loads Master_Fragen_Muendlich with 244 rows (regression)", async () => {
    const sheet = await loadSheet("Master_Fragen_Muendlich");
    expect(sheet.numRows).toBe(244);
    expect(sheet.rows).toHaveLength(244);
  });

  it("loads Übersicht with 82 rows and 37 cols", async () => {
    const sheet = await loadSheet("Übersicht");
    expect(sheet.numRows).toBe(82);
    expect(sheet.numCols).toBe(37);
  });

  it("stores raw gviz cols/headers/rows verbatim", async () => {
    const sheet = await loadSheet("Aachen");
    expect(Array.isArray(sheet.cols)).toBe(true);
    expect(Array.isArray(sheet.headers)).toBe(true);
    expect(Array.isArray(sheet.rows)).toBe(true);
    // No data was mutated: row cell values are preserved.
    expect(sheet.rows[0].length).toBeGreaterThan(0);
  });
});
