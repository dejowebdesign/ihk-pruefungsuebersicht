import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverSheets, fetchSheet, parseGvizPayload } from "../src/importer/gviz-client";

// Build a realistic gviz setResponse payload for a given set of rows.
function gvizPayload(cols: { label: string | null }[], rows: (unknown | null)[][]) {
  const colStr = JSON.stringify(cols);
  const rowStr = JSON.stringify(
    rows.map((r) => ({ c: r.map((v) => (v === null ? null : { v })) })),
  );
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":${colStr},"rows":${rowStr},"parsedNumHeaders":1}});`;
}

const PREVIEW_HTML = (sheets: { name: string; gid: string }[]) =>
  `<html><script>var init=[]; ${sheets
    .map(
      (s) =>
        `items.push({name: "${s.name}", pageUrl: "x", gid: "${s.gid}"});`,
    )
    .join("")} </script></html>`;

function mockFetch(opts: {
  previewHtml?: string;
  sheetPayloads?: Record<string, string>; // by gid
  status?: number;
}) {
  const calls: string[] = [];
  const impl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/preview?")) {
      if (opts.status && opts.status >= 400) {
        return new Response("err", { status: opts.status });
      }
      return new Response(opts.previewHtml ?? PREVIEW_HTML([]), { status: 200 });
    }
    if (url.includes("/gviz/tq?")) {
      const gid = new URL(url, "https://x").searchParams.get("gid")!;
      const payload = opts.sheetPayloads?.[gid];
      if (!payload) throw new Error(`no payload for gid ${gid}`);
      return new Response(payload, { status: 200 });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("gviz client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("discovers sheets from the preview HTML", async () => {
    const { impl } = mockFetch({
      previewHtml: PREVIEW_HTML([
        { name: "Übersicht", gid: "0" },
        { name: "Aachen", gid: "267650592" },
        { name: "München", gid: "1291433490" },
      ]),
    });
    const refs = await discoverSheets({ fetchImpl: impl });
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ name: "Übersicht", gid: "0" });
    expect(refs[1]).toEqual({ name: "Aachen", gid: "267650592" });
    expect(refs[2]).toEqual({ name: "München", gid: "1291433490" });
  });

  it("decodes Umlaut escapes in sheet names", async () => {
    const html = `items.push({name: "\u00dcbersicht", pageUrl: "x", gid: "0"});`;
    const { impl } = mockFetch({ previewHtml: html });
    const refs = await discoverSheets({ fetchImpl: impl });
    expect(refs[0].name).toBe("Übersicht");
  });

  it("throws if no sheets can be parsed (format changed)", async () => {
    const { impl } = mockFetch({ previewHtml: "<html>no items here</html>" });
    await expect(discoverSheets({ fetchImpl: impl })).rejects.toThrow(
      /Could not parse any sheets/,
    );
  });

  it("fetches and parses a gviz sheet response", async () => {
    const payload = gvizPayload(
      [
        { label: "ID" },
        { label: "Frage" },
        { label: null },
      ],
      [
        [1, "Was ist Recht?", null],
        [2, "BGB?", null],
      ],
    );
    const { impl } = mockFetch({
      previewHtml: PREVIEW_HTML([{ name: "Master_Fragen_Muendlich", gid: "765582598" }]),
      sheetPayloads: { "765582598": payload },
    });
    const sheet = await fetchSheet({ name: "Master_Fragen_Muendlich", gid: "765582598" }, {
      fetchImpl: impl,
    });
    expect(sheet.sheetName).toBe("Master_Fragen_Muendlich");
    expect(sheet.numRows).toBe(2);
    expect(sheet.numCols).toBe(3);
    expect(sheet.headers).toEqual(["ID", "Frage", null]);
    expect(sheet.rows[0][1]).toBe("Was ist Recht?");
    expect(sheet.rows[1][0]).toBe(2);
  });

  it("throws on a malformed gviz payload (no setResponse marker)", async () => {
    const { impl } = mockFetch({
      previewHtml: PREVIEW_HTML([{ name: "X", gid: "1" }]),
      sheetPayloads: { "1": "totally not gviz" },
    });
    await expect(
      fetchSheet({ name: "X", gid: "1" }, { fetchImpl: impl }),
    ).rejects.toThrow(/setResponse/);
  });

  it("throws on a non-ok HTTP response", async () => {
    const { impl } = mockFetch({ status: 403 });
    await expect(discoverSheets({ fetchImpl: impl })).rejects.toThrow(/HTTP 403/);
  });

  it("parseGvizPayload accepts the standard marker", () => {
    const p = parseGvizPayload(
      `google.visualization.Query.setResponse({"status":"ok","table":{"cols":[],"rows":[]}});`,
    );
    expect(p.status).toBe("ok");
    expect(p.table.rows).toEqual([]);
  });
});
