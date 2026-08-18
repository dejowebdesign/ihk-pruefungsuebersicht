import { describe, it, expect } from "vitest";
import { validateSnapshot, EXPECTED_TOTAL_SHEETS } from "../src/lib/validate";
import { loadAllSheets, loadSheet } from "../src/lib/snapshot-loader";

describe("validateSnapshot", () => {
  it("accepts the full real snapshot", async () => {
    const sheets = await loadAllSheets();
    const r = validateSnapshot(sheets);
    expect(r.ok).toBe(true);
    expect(r.sheetCount).toBe(EXPECTED_TOTAL_SHEETS);
    expect(r.hasOverview).toBe(true);
    expect(r.hasMasterQuestions).toBe(true);
    expect(r.hasMasterCases).toBe(true);
    expect(r.hasFrequentErrors).toBe(true);
  });

  it("fails when critical sheets are missing", async () => {
    const sheets = await loadAllSheets();
    const filtered = sheets.filter((s) => s.sheetName !== "Übersicht");
    const r = validateSnapshot(filtered);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Übersicht"))).toBe(true);
  });

  it("fails when Übersicht is implausibly empty", async () => {
    const sheets = await loadAllSheets();
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    const empty = { ...overview, rows: overview.rows.slice(0, 5) };
    const replaced = sheets.map((s) => (s.sheetName === "Übersicht" ? empty : s));
    const r = validateSnapshot(replaced);
    expect(r.ok).toBe(false);
  });

  it("warns (but does not fail) on small sheet-count drift", async () => {
    const sheets = await loadAllSheets();
    // Drop one IHK sheet: 84 total — should warn but still be ok if criticals present.
    const filtered = sheets.filter((s) => s.sheetName !== "Ulm");
    const r = validateSnapshot(filtered);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("84"))).toBe(true);
  });

  it("fails hard when total sheet count drops below minimum", async () => {
    const sheets = await loadAllSheets();
    const filtered = sheets.slice(0, 10);
    const r = validateSnapshot(filtered);
    expect(r.ok).toBe(false);
  });
});
