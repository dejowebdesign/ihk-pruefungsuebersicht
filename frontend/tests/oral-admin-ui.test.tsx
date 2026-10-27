// Oral-exam overview UI: PDF actions only for completed exams, and the
// two-step delete confirmation.
//
// The list page is exercised against a stubbed fetch so the real component,
// the real ConfirmDialog and the real api client all run.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OralExam } from "@/lib/api";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/muendliche-pruefung",
  useRouter: () => ({ replace, push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function exam(over: Partial<OralExam>): OralExam {
  return {
    id: "e1",
    candidateId: "c1",
    candidate: { id: "c1", name: "Max Mustermann" },
    examDate: "2026-08-19T00:00:00.000Z",
    examiner: "Dr. Prüfer",
    status: "completed",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    completedAt: "2026-08-19T00:00:00.000Z",
    maxPoints: 100,
    totalPoints: 72,
    percent: 72,
    result: "Bestanden",
    items: [],
    ...over,
  };
}

/** Route fetch calls by URL so the page can load normally. */
function mockApi(opts: {
  exams?: OralExam[];
  role?: "admin" | "participant";
  deleteStatus?: number;
  deleteError?: string;
}) {
  const { exams = [], role = "admin", deleteStatus = 200, deleteError } = opts;
  const calls: Array<{ url: string; method: string }> = [];

  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    const json = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      }) as unknown as Response;

    if (url.startsWith("/api/auth/me")) {
      return json(200, {
        user: { id: "u1", username: role === "admin" ? "admin" : "anna", role, active: true },
      });
    }
    if (url.startsWith("/api/oral/exams?") || url === "/api/oral/exams") {
      return json(200, { data: exams, pagination: { page: 1, limit: 50, total: exams.length, totalPages: 1 } });
    }
    if (method === "DELETE") {
      return deleteStatus >= 400
        ? json(deleteStatus, { error: deleteError ?? "Fehler" })
        : json(200, { ok: true, deletedItems: 13, deletedCandidates: [] });
    }
    return json(404, { error: "not found" });
  }) as typeof fetch);

  return calls;
}

async function renderPage() {
  const { default: OralExamsPage } = await import("@/app/muendliche-pruefung/page");
  render(<OralExamsPage />);
}

beforeEach(() => {
  localStorage.clear();
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

describe("PDF actions in the overview", () => {
  it("offers download and open links for a completed exam", async () => {
    mockApi({ exams: [exam({ id: "done", status: "completed" })] });
    await renderPage();

    const open = await screen.findByRole("link", { name: "PDF öffnen" });
    expect(open).toHaveAttribute("href", "/api/oral/exams/done/pdf");
    expect(open).toHaveAttribute("target", "_blank");

    const download = screen.getByRole("link", { name: "PDF herunterladen" });
    expect(download).toHaveAttribute("href", "/api/oral/exams/done/pdf?disposition=attachment");
    // A download link must not open a new tab.
    expect(download).not.toHaveAttribute("target", "_blank");
  });

  it("shows no PDF actions for an exam that is not completed", async () => {
    mockApi({ exams: [exam({ id: "draft", status: "in_progress", result: null })] });
    await renderPage();

    await screen.findByText("Max Mustermann");
    expect(screen.queryByRole("link", { name: "PDF öffnen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PDF herunterladen" })).not.toBeInTheDocument();
  });

  it("mixes both: only the completed row gets PDF actions", async () => {
    mockApi({
      exams: [
        exam({ id: "done", status: "completed" }),
        exam({ id: "draft", status: "draft", candidate: { id: "c2", name: "Erika Muster" }, result: null }),
      ],
    });
    await renderPage();

    await screen.findByText("Max Mustermann");
    expect(screen.getAllByRole("link", { name: "PDF öffnen" })).toHaveLength(1);
    const doneHref = screen.getByRole("link", { name: "PDF öffnen" }).getAttribute("href");
    expect(doneHref).toBe("/api/oral/exams/done/pdf");
  });
});

describe("delete confirmation", () => {
  it("asks for confirmation before deleting anything", async () => {
    const calls = mockApi({ exams: [exam({ id: "e1" })] });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));

    // The dialog is shown and NO request was sent yet.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Prüfung löschen?")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("cancelling closes the dialog and sends no request", async () => {
    const calls = mockApi({ exams: [exam({ id: "e1" })] });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    await screen.findByRole("alertdialog");
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    // The row is still listed.
    expect(screen.getByText("Max Mustermann")).toBeInTheDocument();
  });

  it("cancelling with Escape also sends no request", async () => {
    const calls = mockApi({ exams: [exam({ id: "e1" })] });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("confirming sends the DELETE with the confirmation flag", async () => {
    const calls = mockApi({ exams: [exam({ id: "e1" })] });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));

    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del).toBeTruthy();
      expect(del!.url).toBe("/api/oral/exams/e1?confirm=true");
    });
  });

  it("refreshes the overview after a successful delete", async () => {
    const calls = mockApi({ exams: [exam({ id: "e1" })] });
    await renderPage();

    const listCallsBefore = calls.filter((c) => c.url.startsWith("/api/oral/exams?")).length;

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));

    await waitFor(() => {
      const listCallsAfter = calls.filter((c) => c.url.startsWith("/api/oral/exams?")).length;
      expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
    });
    // Confirmation is reported back to the user.
    expect(await screen.findByText(/wurde gelöscht/)).toBeInTheDocument();
  });

  it("surfaces a server error and keeps the row", async () => {
    mockApi({ exams: [exam({ id: "e1" })], deleteStatus: 404, deleteError: "Prüfung nicht gefunden" });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));

    expect(await screen.findByText("Prüfung nicht gefunden")).toBeInTheDocument();
    // The row is still in the table.
    expect(screen.getAllByText("Max Mustermann").length).toBeGreaterThan(0);
  });
});

describe("role-dependent controls", () => {
  it("a participant gets no delete button and no create form", async () => {
    mockApi({ exams: [exam({ id: "e1" })], role: "participant" });
    await renderPage();

    await screen.findByText("Max Mustermann");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Neue Prüfung/ })).not.toBeInTheDocument();
    // Their own completed exam still offers the PDF.
    expect(screen.getByRole("link", { name: "PDF öffnen" })).toBeInTheDocument();
  });

  it("an admin gets the create form and the delete button", async () => {
    mockApi({ exams: [exam({ id: "e1" })], role: "admin" });
    await renderPage();

    expect(await screen.findByRole("button", { name: /Neue Prüfung/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
  });
});
