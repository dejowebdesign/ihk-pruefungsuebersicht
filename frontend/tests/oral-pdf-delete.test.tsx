// Frontend tests for the two new oral-exam features:
//  - PDF-Auswertung button on a completed exam (download + open)
//  - Löschen action on the exam overview (confirm dialog, cancel, confirm, removal)
//
// The Next.js pages are client components using hooks/router. We render them
// directly and stub the `@/lib/api` and `@/lib/oral-auth` modules so we control
// the data and the admin token.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OralExam, OralExamQuestion, OralRating } from "@/lib/api";

// ── stubs (hoisted so vi.mock factories can reference them) ────────────────

const { apiMocks, getStoredToken, push, windowOpen, fetchMock } = vi.hoisted(() => ({
  apiMocks: {
    oralExams: vi.fn(),
    oralExam: vi.fn(),
    oralExamPdfUrl: vi.fn((id: string, download = false) =>
      `/api/oral/exams/${id}/pdf${download ? "?download=1" : ""}`),
    oralDeleteExam: vi.fn(),
    oralCompleteExam: vi.fn(),
    oralRateQuestion: vi.fn(),
    oralThemes: vi.fn(), oralPool: vi.fn(), oralExamScore: vi.fn(),
    oralCreateExam: vi.fn(), oralUpdateExam: vi.fn(), oralSeedPool: vi.fn(),
  },
  getStoredToken: vi.fn(() => "test-token"),
  push: vi.fn(),
  windowOpen: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMocks,
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(m: string, s: number) { super(m); this.status = s; }
  },
  Paginated: {} as never,
}));

vi.mock("@/lib/oral-auth", () => ({ getStoredToken }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/muendliche-pruefung",
}));

const WEIGHTS = [10, 12, 14, 14, 8, 18, 8, 16];

function makeItem(orderKey: number, weight: number, rating: OralRating | null): OralExamQuestion {
  const points = rating === "richtig" ? weight : rating === "teilweise richtig" ? weight / 2 : 0;
  return {
    id: `q${orderKey}`, examId: "e1", questionId: `p${orderKey}`, orderKey,
    themeName: `Themenbereich ${orderKey}`, weight, rating, points, note: null,
    question: { excelId: `X-${orderKey}`, question: `Frage ${orderKey}?`, answer: null, source: null },
  };
}

function makeExam(opts: {
  id?: string; name?: string; status?: "draft" | "in_progress" | "completed";
  total?: number; percent?: number; result?: "Bestanden" | "Nicht bestanden";
  examiner?: string | null; examDate?: string | null;
}): OralExam {
  const items = WEIGHTS.map((w, i) => makeItem(i + 1, w, opts.status === "completed" ? "richtig" : null));
  const total = opts.total ?? 100;
  const percent = opts.percent ?? 100;
  return {
    id: opts.id ?? "e1",
    candidateId: "c1",
    candidate: { id: "c1", name: opts.name ?? "Max Mustermann" },
    examDate: opts.examDate ?? "2026-08-17T00:00:00.000Z",
    examiner: opts.examiner ?? "Prüfer A",
    status: opts.status ?? "completed",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    completedAt: opts.status === "completed" ? "2026-08-17T00:00:00.000Z" : null,
    maxPoints: 100, totalPoints: total, percent, result: opts.result ?? "Bestanden",
    items,
  };
}

// `api` is imported as a namespace in pages; the stubs live in `apiMocks`.
// window.open / fetch for PDF download+open paths are set in beforeEach.

import OralDetailPage from "@/app/muendliche-pruefung/[id]/page";
import OralExamsPage from "@/app/muendliche-pruefung/page";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { open: typeof window.open }).open = windowOpen as unknown as typeof window.open;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // jsdom lacks URL.createObjectURL/revokeObjectURL.
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake"), writable: true, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true, configurable: true });
  // jsdom's navigator.clipboard is undefined; force a writable clipboard so the
  // page's `navigator.clipboard.writeText(...)` path works in tests.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

// ── PDF button on a completed exam ─────────────────────────────────────────

describe("oral detail page — PDF-Auswertung (completed exams)", () => {
  it("shows the PDF-Auswertung + PDF öffnen buttons on a completed exam", async () => {
    const exam = makeExam({ status: "completed", percent: 100, result: "Bestanden" });
    apiMocks.oralExam.mockResolvedValue(exam);
    render(<OralDetailPage params={{ id: "e1" }} />);
    await waitFor(() => expect(screen.getByText("Gesamtergebnis")).toBeInTheDocument());
    expect(screen.getByTestId("oral-pdf-download")).toHaveTextContent("PDF-Auswertung");
    expect(screen.getByTestId("oral-pdf-open")).toHaveTextContent("PDF öffnen");
  });

  it("PDF-Auswertung triggers a PDF download via fetch blob", async () => {
    const exam = makeExam({ status: "completed", name: "Luna E2E", percent: 55, result: "Bestanden", total: 55 });
    apiMocks.oralExam.mockResolvedValue(exam);
    const blob = new Blob(["%PDF- fake"], { type: "application/pdf" });
    fetchMock.mockResolvedValue({ ok: true, blob: async () => blob } as Response);

    const user = userEvent.setup();
    render(<OralDetailPage params={{ id: "e1" }} />);
    await waitFor(() => expect(screen.getByTestId("oral-pdf-download")).toBeInTheDocument());

    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await user.click(screen.getByTestId("oral-pdf-download"));

    expect(apiMocks.oralExamPdfUrl).toHaveBeenCalledWith("e1", true);
    expect(fetchMock).toHaveBeenCalledWith("/api/oral/exams/e1/pdf?download=1");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("PDF öffnen opens the inline PDF URL in a new tab", async () => {
    const exam = makeExam({ status: "completed", percent: 100, result: "Bestanden" });
    apiMocks.oralExam.mockResolvedValue(exam);
    const user = userEvent.setup();
    render(<OralDetailPage params={{ id: "e1" }} />);
    await waitFor(() => expect(screen.getByTestId("oral-pdf-open")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-pdf-open"));
    expect(apiMocks.oralExamPdfUrl).toHaveBeenCalledWith("e1", false);
    expect(windowOpen).toHaveBeenCalledWith("/api/oral/exams/e1/pdf", "_blank");
  });

  it("'Gesamtwert kopieren' still works alongside PDF buttons", async () => {
    const exam = makeExam({ status: "completed", percent: 55, result: "Bestanden", total: 55 });
    apiMocks.oralExam.mockResolvedValue(exam);
    // jsdom's clipboard is unavailable, so the page falls back to the
    // execCommand path — both paths set "Kopiert ✓". We assert the visible
    // behavior (button label flips) and that the rounded percent is the copy
    // source by checking the rendered percent.
    document.execCommand = vi.fn();
    const user = userEvent.setup();
    render(<OralDetailPage params={{ id: "e1" }} />);
    await waitFor(() => expect(screen.getByText("Gesamtwert kopieren")).toBeInTheDocument());
    expect(screen.getByText("55 %")).toBeInTheDocument();
    await user.click(screen.getByText("Gesamtwert kopieren"));
    await waitFor(() => expect(screen.getByText("Kopiert ✓")).toBeInTheDocument());
  });

  it("does NOT show PDF buttons on an in-progress exam", async () => {
    const exam = makeExam({ status: "in_progress", percent: 0, result: null });
    apiMocks.oralExam.mockResolvedValue(exam);
    render(<OralDetailPage params={{ id: "e1" }} />);
    await waitFor(() => expect(screen.getByText("Frage 1 von 8")).toBeInTheDocument());
    expect(screen.queryByTestId("oral-pdf-download")).not.toBeInTheDocument();
    expect(screen.queryByTestId("oral-pdf-open")).not.toBeInTheDocument();
  });
});

// ── Delete on the overview ──────────────────────────────────────────────────

describe("oral overview — Löschen", () => {
  function setExams(exams: OralExam[]) {
    apiMocks.oralExams.mockResolvedValue({
      data: exams,
      pagination: { page: 1, limit: 50, total: exams.length, totalPages: 1 },
    });
  }

  it("shows a Löschen button per exam in the overview", async () => {
    const a = makeExam({ id: "a", name: "Alpha", status: "completed", percent: 100, result: "Bestanden" });
    const b = makeExam({ id: "b", name: "Beta", status: "in_progress" });
    setExams([a, b]);
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(screen.getByTestId(`oral-delete-btn-${a.id}`)).toHaveTextContent("Löschen");
    expect(screen.getByTestId(`oral-delete-btn-${b.id}`)).toHaveTextContent("Löschen");
  });

  it("clicking Löschen opens a confirmation dialog with Abbrechen + Löschen", async () => {
    const a = makeExam({ id: "a", name: "Alpha", status: "completed", percent: 100, result: "Bestanden" });
    setExams([a]);
    const user = userEvent.setup();
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByTestId("oral-delete-btn-a")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-delete-btn-a"));
    expect(screen.getByTestId("oral-delete-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Prüfung wirklich löschen\?/)).toBeInTheDocument();
    expect(screen.getByTestId("oral-delete-cancel")).toHaveTextContent("Abbrechen");
    expect(screen.getByTestId("oral-delete-confirm")).toHaveTextContent("Löschen");
  });

  it("Abbrechen closes the dialog and deletes nothing", async () => {
    const a = makeExam({ id: "a", name: "Alpha", status: "completed", percent: 100, result: "Bestanden" });
    setExams([a]);
    const user = userEvent.setup();
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByTestId("oral-delete-btn-a")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-delete-btn-a"));
    await user.click(screen.getByTestId("oral-delete-cancel"));
    expect(screen.queryByTestId("oral-delete-dialog")).not.toBeInTheDocument();
    expect(apiMocks.oralDeleteExam).not.toHaveBeenCalled();
    // row still present
    expect(screen.getByTestId("oral-exam-row-a")).toBeInTheDocument();
  });

  it("Bestätigen calls oralDeleteExam and removes the row", async () => {
    const a = makeExam({ id: "a", name: "Alpha", status: "completed", percent: 100, result: "Bestanden" });
    const b = makeExam({ id: "b", name: "Beta", status: "in_progress" });
    // First load: two exams. After delete, oralExams is called again and returns only b.
    apiMocks.oralExams.mockResolvedValueOnce({
      data: [a, b],
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
    }).mockResolvedValueOnce({
      data: [b],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    apiMocks.oralDeleteExam.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByTestId("oral-exam-row-a")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-delete-btn-a"));
    await user.click(screen.getByTestId("oral-delete-confirm"));
    expect(apiMocks.oralDeleteExam).toHaveBeenCalledWith("test-token", "a");
    await waitFor(() => expect(screen.queryByTestId("oral-exam-row-a")).not.toBeInTheDocument());
    // the other exam remains
    expect(screen.getByTestId("oral-exam-row-b")).toBeInTheDocument();
  });

  it("existing (other) exams remain untouched after a delete", async () => {
    const keep = makeExam({ id: "keep", name: "Keep Me", status: "completed", percent: 80, result: "Bestanden", total: 80 });
    const victim = makeExam({ id: "victim", name: "Delete Me", status: "in_progress" });
    apiMocks.oralExams.mockResolvedValueOnce({
      data: [keep, victim],
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
    }).mockResolvedValueOnce({
      data: [keep],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    apiMocks.oralDeleteExam.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByTestId("oral-exam-row-keep")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-delete-btn-victim"));
    await user.click(screen.getByTestId("oral-delete-confirm"));
    await waitFor(() => expect(screen.queryByTestId("oral-exam-row-victim")).not.toBeInTheDocument());
    const keepRow = screen.getByTestId("oral-exam-row-keep");
    expect(keepRow).toBeInTheDocument();
    // kept exam's data unchanged in the rendered row
    expect(keepRow).toHaveTextContent("Keep Me");
    expect(keepRow).toHaveTextContent("Bestanden");
  });

  it("refuses to delete without an admin token (shows hint)", async () => {
    getStoredToken.mockReturnValueOnce(null);
    const a = makeExam({ id: "a", name: "Alpha", status: "in_progress" });
    setExams([a]);
    const user = userEvent.setup();
    render(<OralExamsPage />);
    await waitFor(() => expect(screen.getByTestId("oral-delete-btn-a")).toBeInTheDocument());
    await user.click(screen.getByTestId("oral-delete-btn-a"));
    await user.click(screen.getByTestId("oral-delete-confirm"));
    expect(apiMocks.oralDeleteExam).not.toHaveBeenCalled();
    expect(screen.getByText(/Administrator-Token/)).toBeInTheDocument();
  });
});
