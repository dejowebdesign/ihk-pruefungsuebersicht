import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { loadAllSheets } from "../src/lib/snapshot-loader";
import { makeIsolatedDb } from "./helpers/db";
import { persistImport } from "../src/importer/persist";
import type { SheetJson } from "../src/lib/types";
import type { PrismaClient } from "@prisma/client";

let client: PrismaClient;
let cleanup: () => Promise<void>;

// Build a fake `fetch` impl that serves the snapshot sheets as gviz payloads,
// so the live-import path can be exercised without real network access.
function buildFakeGvizFetch(snapshots: SheetJson[]) {
  const byName = new Map(snapshots.map((s) => [s.sheetName, s]));
  const previewHtml =
    `<script>${snapshots
      .map((s) => `items.push({name: "${s.sheetName}", pageUrl: "x", gid: "${s.gid}"});`)
      .join("")}</script>`;

  const impl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/preview?")) {
      return new Response(previewHtml, { status: 200 });
    }
    if (url.includes("/gviz/tq?")) {
      const gid = new URL(url, "https://x").searchParams.get("gid")!;
      const sheet = snapshots.find((s) => s.gid === gid);
      if (!sheet) throw new Error(`no sheet for gid ${gid}`);
      // Reconstruct a gviz setResponse payload from the snapshot's cols/rows.
      const cols = (sheet.cols as { label?: string | null; id?: string; type?: string }[]) ?? [];
      const rows = sheet.rows.map((r) => ({
        c: r.map((v) => (v === null || v === undefined ? null : { v })),
      }));
      const payload = `/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":${JSON.stringify(
        cols,
      )},"rows":${JSON.stringify(rows)}}});`;
      return new Response(payload, { status: 200 });
    }
    // Fall back: serve the manifest names lookup.
    void byName;
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
  return impl;
}

beforeAll(async () => {
  ({ client, cleanup } = await makeIsolatedDb());
}, 180_000);

afterAll(async () => {
  await cleanup();
});

describe("live importer (snapshot-fed gviz mock)", () => {
  it("runs a successful live import via fetchAllSheets + persistImport", async () => {
    const snapshots = await loadAllSheets();
    const fetchImpl = buildFakeGvizFetch(snapshots);
    const { fetchAllSheets } = await import("../src/importer/gviz-client");
    const sheets = await fetchAllSheets({ fetchImpl, requestDelayMs: 0 });

    expect(sheets).toHaveLength(85);
    // Round-trip through gviz payload preserves data: Übersicht has 82 rows.
    const overview = sheets.find((s) => s.sheetName === "Übersicht")!;
    expect(overview.rows).toHaveLength(82);

    const result = await persistImport(sheets, {
      source: "google-gviz",
      sourceRef: "mock-sheet-id",
      db: client,
      snapshotVersion: "gviz-test",
    });
    expect(result.status).toBe("SUCCESS");
    expect(result.sheetsDetected).toBe(85);
    expect(result.sheetsImported).toBe(85);
    expect(result.ihkLocations).toBe(82);
    expect(result.questions).toBe(244);
    expect(result.caseExamples).toBe(30);
    expect(result.rawRows).toBeGreaterThan(3250);

    const run = await client.importRun.findUnique({ where: { id: result.importRunId! } });
    expect(run?.source).toBe("google-gviz");
    expect(run?.status).toBe("SUCCESS");
  });

  it("rejects a malformed gviz response (setResponse marker missing)", async () => {
    const snapshots = await loadAllSheets();
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview?")) {
        const previewHtml = `<script>${snapshots
          .map((s) => `items.push({name: "${s.sheetName}", pageUrl: "x", gid: "${s.gid}"});`)
          .join("")}</script>`;
        return new Response(previewHtml, { status: 200 });
      }
      return new Response("not a gviz response", { status: 200 });
    }) as unknown as typeof fetch;
    const { fetchAllSheets } = await import("../src/importer/gviz-client");
    await expect(
      fetchAllSheets({ fetchImpl, requestDelayMs: 0 }),
    ).rejects.toThrow(/setResponse/);
  });

  it("rejects an empty sheet payload (no rows) via validation fail-safe", async () => {
    const snapshots = await loadAllSheets();
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview?")) {
        const previewHtml = `<script>${snapshots
          .map((s) => `items.push({name: "${s.sheetName}", pageUrl: "x", gid: "${s.gid}"});`)
          .join("")}</script>`;
        return new Response(previewHtml, { status: 200 });
      }
      if (url.includes("/gviz/tq?")) {
        const gid = new URL(url, "https://x").searchParams.get("gid")!;
        const sheet = snapshots.find((s) => s.gid === gid)!;
        // Return an EMPTY table for Übersicht -> implausibly few IHK rows.
        const payload =
          sheet.sheetName === "Übersicht"
            ? `google.visualization.Query.setResponse({"status":"ok","table":{"cols":[],"rows":[]}});`
            : `google.visualization.Query.setResponse({"status":"ok","table":{"cols":${JSON.stringify(
                sheet.cols,
              )},"rows":${JSON.stringify(
                sheet.rows.map((r) => ({ c: r.map((v) => (v === null ? null : { v })) })),
              )}}});`;
        return new Response(payload, { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    const { fetchAllSheets } = await import("../src/importer/gviz-client");
    const sheets = await fetchAllSheets({ fetchImpl, requestDelayMs: 0 });
    const result = await persistImport(sheets, {
      source: "google-gviz",
      sourceRef: "empty-overview",
      db: client,
    });
    expect(result.status).toBe("FAILED");
    // Prior data untouched.
    const ihkCount = await client.ihkLocation.count();
    expect(ihkCount).toBe(82);
  });
});
