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

  it("triggerImport sends POST without any client-supplied credential", async () => {
    const body = { message: "ok", runId: "r1" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    const res = await api.triggerImport();
    expect(res.message).toBe("ok");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    // The session rides in an httpOnly cookie — the client never sets a token.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("login posts the credentials and relies on the session cookie", async () => {
    const body = { user: { id: "u1", username: "admin", role: "admin", active: true } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    const res = await api.login("admin", "geheim-123");
    expect(res.user.role).toBe("admin");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      username: "admin",
      password: "geheim-123",
    });
    expect(init.credentials).toBe("same-origin");
  });

  it("logout posts to /api/auth/logout", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body: { ok: true } }));
    await api.logout();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
  });

  it("every request is sent with same-origin credentials", async () => {
    const body = { data: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body }));
    await api.ihkList();
    expect((spy.mock.calls[0][1] as RequestInit).credentials).toBe("same-origin");
  });

  it("oralExamPdfUrl points at the exam PDF endpoint", () => {
    expect(api.oralExamPdfUrl("abc")).toBe("/api/oral/exams/abc/pdf");
    expect(api.oralExamPdfUrl("abc", true)).toBe("/api/oral/exams/abc/pdf?disposition=attachment");
    // Ids are escaped, so a crafted id cannot break out of the path.
    expect(api.oralExamPdfUrl("a/b")).toBe("/api/oral/exams/a%2Fb/pdf");
  });

  it("oralDeleteExam sends DELETE with the explicit confirmation flag", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetch({ body: { ok: true, deletedItems: 13, deletedCandidates: [] } }),
    );
    await api.oralDeleteExam("exam-1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/oral/exams/exam-1?confirm=true");
    expect(init.method).toBe("DELETE");
  });

  it("user management calls the admin endpoints", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetch({ body: { data: [] } }));
    await api.users();
    expect(spy.mock.calls[0][0]).toBe("/api/users");

    spy.mockResolvedValue(mockFetch({ body: { user: { id: "u", username: "a", role: "participant", active: true } } }));
    await api.updateUser("u1", { active: false });
    const [url, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/users/u1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ active: false });
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
