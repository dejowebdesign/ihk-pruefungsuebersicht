// Phase 11 — the oral-exam UI shows PERCENTAGES only.
//
// These tests render the REAL page component against a stubbed fetch, so they
// fail if a points value, a "Punkte" label or a point bar ever comes back.
// The per-theme breakdown comes from the backend payload (exam.breakdown).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { OralExam } from "@/lib/api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/muendliche-pruefung/e1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** An exam whose stored percent is 77.5 (the mixed-exam example). */
function makeExam(over: Partial<OralExam> = {}): OralExam {
  const themes: Array<[string, number, number]> = [
    ["Buergerliches Gesetzbuch / Jedermannsrechte", 100, 18],
    ["Straf- und Verfahrensrecht", 50, 18],
    ["Umgang mit Menschen / Deeskalation", 75, 18],
    ["Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht", 100, 10],
    ["Datenschutzrecht", 100, 9],
    ["Unfallverhuetungsvorschriften", 0, 9],
    ["Umgang mit Waffen", 100, 9],
    ["Grundlagen der Sicherheitstechnik", 100, 9],
  ];
  return {
    id: "e1",
    candidateId: "c1",
    candidate: { id: "c1", name: "Max Mustermann" },
    examDate: "2026-08-19T00:00:00.000Z",
    examiner: "Dr. Pruefer",
    status: "completed",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    completedAt: "2026-08-19T00:00:00.000Z",
    maxPoints: 100,
    totalPoints: 0,
    percent: 77.5,
    result: "Bestanden",
    breakdown: themes.map(([themeName, percent, weight]) => ({
      themeName,
      weight,
      asked: weight === 18 || weight === 10 ? 2 : 1,
      achieved: 0,
      percent,
      contribution: (percent / 100) * weight,
    })),
    items: [
      {
        id: "i1",
        orderKey: 1,
        themeName: themes[0][0],
        weight: 18,
        rating: "richtig",
        note: "Sehr sicher",
        question: { excelId: "BGB-01", question: "Frage 1?", answer: "Antwort 1" },
      },
    ],
    ...over,
  };
}

function mockApi(exam: OralExam) {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("/api/auth/me")
      ? { user: { id: "u1", username: "admin", role: "admin", active: true } }
      : url.includes("/api/oral/exams/e1")
        ? exam
        : { data: [], pagination: {} };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response;
  }) as unknown as typeof fetch);
}

// The page reads the identity from the cache the auth layer writes.
beforeEach(() => {
  localStorage.setItem(
    "ihk-identity",
    JSON.stringify({ id: "u1", username: "admin", role: "admin", active: true }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function renderExamPage() {
  const Page = (await import("@/app/muendliche-pruefung/[id]/page")).default;
  render(<Page params={{ id: "e1" }} />);
  await waitFor(() => expect(screen.getByText(/Max Mustermann/)).toBeTruthy());
}

describe("oral result screen — percent only", () => {
  it("shows the overall percent rounded and the result", async () => {
    mockApi(makeExam());
    await renderExamPage();
    // 78 % appears in the big result and in the breakdown total row.
    expect(screen.getAllByText("78 %").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Bestanden")).toBeTruthy();
  });

  it("never renders the word Punkte or any point value", async () => {
    mockApi(makeExam());
    await renderExamPage();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Punkte/);
    expect(text).not.toMatch(/\d+\s*\/\s*100\s*Punkte/);
  });

  it("renders the per-theme breakdown with Ergebnis, Gewichtung and Beitrag", async () => {
    mockApi(makeExam());
    await renderExamPage();
    const table = screen.getByText("Auswertung nach Themengebiet").closest("details")!;
    const rows = within(table).getAllByRole("row");
    // header + 8 themes + total row
    expect(rows.length).toBe(10);

    // BGB: 100 % result, 18 % weight, 18 % contribution
    const bgb = rows.find((r) => r.textContent?.includes("Buergerliches Gesetzbuch"))!;
    expect(bgb.textContent).toContain("100 %");
    expect(bgb.textContent).toContain("18 %");

    // The total row carries the overall result.
    expect(within(table).getByText("Gesamtergebnis")).toBeTruthy();
    expect(table.textContent).toContain("78 %");
  });

  it("shows a fractional theme result exactly (no premature rounding)", async () => {
    mockApi(
      makeExam({
        percent: 13.5,
        breakdown: [
          {
            themeName: "Buergerliches Gesetzbuch / Jedermannsrechte",
            weight: 18,
            asked: 2,
            achieved: 1.5,
            percent: 75,
            contribution: 13.5,
          },
        ],
      }),
    );
    await renderExamPage();
    // 13.5 must not be flattened to 13 or 14 in the breakdown.
    expect(document.body.textContent).toContain("13,5");
  });

  it("keeps the PDF actions available for a completed exam", async () => {
    mockApi(makeExam());
    await renderExamPage();
    expect(screen.getByText("PDF öffnen")).toBeTruthy();
    expect(screen.getByText("PDF-Auswertung herunterladen")).toBeTruthy();
  });
});

describe("oral take screen — percent only", () => {
  it("shows the theme weight in percent and no point values on the rating buttons", async () => {
    mockApi(
      makeExam({
        status: "in_progress",
        result: null,
        percent: 18,
        items: [
          {
            id: "i1",
            orderKey: 1,
            themeName: "Buergerliches Gesetzbuch / Jedermannsrechte",
            weight: 18,
            rating: null,
            note: null,
            question: { excelId: "BGB-01", question: "Frage 1?", answer: "Antwort 1" },
          },
        ],
      }),
    );
    await renderExamPage();
    const takeText = document.body.textContent ?? "";
    expect(takeText).toContain("Gewichtung: 18 %");
    // Rating buttons describe the share, not points.
    expect(screen.getByText("100 %")).toBeTruthy();
    expect(screen.getByText("50 %")).toBeTruthy();
    expect(screen.getByText("0 %")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Pkt\./);
  });
});
