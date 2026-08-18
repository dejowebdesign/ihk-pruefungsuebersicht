import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiClientError } from "@/lib/api";

// Mock global fetch for the api client.
function mockFetch(responses: { status?: number; body: unknown } | Response) {
  const r = responses as Response;
  if (typeof (r as Response).text === "function") return r;
  const cfg = responses as { status?: number; body: unknown };
  const status = cfg.status ?? 200;
  const bodyStr = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
  const res = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyStr,
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("ihkList parses paginated response", async () => {
    const body = {
      data: [
        { id: "a", nr: 1, ihkShortName: "Bielefeld", officialName: "x", sourceSheetId: "s" },
      ],
      pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    const res = await api.ihkList({ page: 1 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].ihkShortName).toBe("Bielefeld");
    expect(res.pagination.total).toBe(1);
  });

  it("ihkList sends filter query params", async () => {
    const body = { data: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    await api.ihkList({ bundesland: "Bayern", skp: "✅" });
    expect(spy).toHaveBeenCalledTimes(1);
    const url = (spy.mock.calls[0][0] as string);
    expect(url).toContain("bundesland=Bayern");
    expect(url).toContain("skp=");
    expect(url).toContain("%E2%9C%85"); // ✅ url-encoded
  });

  it("ihkSearch sends q param", async () => {
    const body = { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    await api.ihkSearch("biele", 1, 50);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("/api/ihk/search");
    expect(url).toContain("q=biele");
  });

  it("ihkDetail calls /api/ihk/:id", async () => {
    const body = {
      id: "abc",
      nr: 1,
      ihkShortName: "Bielefeld",
      officialName: "x",
      sourceSheetId: "s",
      sourceSheet: { id: "s", originalName: "n", gid: "1", sheetType: "ihk" },
      importRun: { id: "r", startedAt: "2024-01-01T00:00:00Z", finishedAt: null },
      semantics: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    const d = await api.ihkDetail("abc");
    expect(d.id).toBe("abc");
    expect(d.sourceSheet.originalName).toBe("n");
  });

  it("adminImport sends POST with bearer auth", async () => {
    const body = { message: "ok", runId: "r1" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    const res = await api.adminImport("secret-token");
    expect(res.message).toBe("ok");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("throws ApiClientError with backend message on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetch({ status: 400, body: { error: "Bad request" } }),
    );
    await expect(api.ihkList()).rejects.toMatchObject({
      name: "ApiClientError",
      message: "Bad request",
      status: 400,
    });
    // ApiClientError is a proper Error subclass.
    await expect(api.ihkList()).rejects.toBeInstanceOf(ApiClientError);
  });

  it("falls back to default message when backend body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetch({ status: 500, body: "Internal Server Error" }),
    );
    await expect(api.ihkList()).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
    });
  });

  it("buildQuery omits empty params", async () => {
    const body = { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    await api.questions(1, 50, "", "", "", "");
    const url = spy.mock.calls[0][0] as string;
    // page & limit present, no empty params.
    expect(url).toContain("page=1");
    expect(url).toContain("limit=50");
    expect(url).not.toContain("q=");
    expect(url).not.toContain("category=");
  });
});
