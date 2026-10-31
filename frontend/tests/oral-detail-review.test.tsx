// Post-exam detail evaluation in the web UI.
//
// The customer's report was that the detail view showed Frage-IDs instead of
// the questions. These tests render the REAL completed-exam page and assert
// that every one of the 13 questions is present with its full wording, its
// rating, the documented answer, the examiner comment (only when one exists)
// and a Musterlösung that starts collapsed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { OralExam } from "@/lib/api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/muendliche-pruefung/e1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const THEMES = [
  "Buergerliches Gesetzbuch / Jedermannsrechte",
  "Straf- und Verfahrensrecht",
  "Umgang mit Menschen / Deeskalation",
  "Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht",
  "Datenschutzrecht",
  "Unfallverhuetungsvorschriften",
  "Umgang mit Waffen",
  "Grundlagen der Sicherheitstechnik",
];

/** 13 items: 9 base themes + 4 extras, exactly like a real exam. */
function makeItems() {
  return Array.from({ length: 13 }, (_, i) => {
    const order = i + 1;
    const theme = THEMES[i % THEMES.length];
    const rating = (["richtig", "teilweise richtig", "falsch"] as const)[i % 3];
    return {
      id: `i${order}`,
      examId: "e1",
      questionId: `q${order}`,
      orderKey: order,
      themeName: theme,
      weight: 9,
      rating,
      // Every fourth question has no examiner comment.
      note: i % 4 === 0 ? null : `Prüferkommentar ${order}`,
      // Every third question has no documented answer.
      candidateAnswer: i % 3 === 2 ? null : `Dokumentierte Antwort ${order}`,
      question: {
        excelId: `T-${String(order).padStart(2, "0")}`,
        question: `Vollständige Fragestellung Nummer ${order} mit mehreren Wörtern?`,
        answer: `Musterlösung Nummer ${order} mit ausführlicher Begründung.`,
        source: null,
      },
    };
  });
}

function makeExam(over: Partial<OralExam> = {}): OralExam {
  const items = makeItems();
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
    breakdown: THEMES.map((themeName, i) => ({
      themeName,
      weight: i === 3 ? 10 : i < 3 ? 18 : 9,
      asked: 1,
      achieved: 0,
      percent: 100,
      contribution: 0,
    })),
    items,
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

describe("completed exam — full question review", () => {
  it("lists all 13 questions as cards", async () => {
    mockApi(makeExam());
    await renderExamPage();
    for (let order = 1; order <= 13; order++) {
      expect(screen.getByTestId(`oral-qcard-${order}`)).toBeTruthy();
    }
    expect(screen.getByText("Gestellte Prüfungsfragen (13)")).toBeTruthy();
  });

  it("shows the FULL question wording for every question, not just the id", async () => {
    mockApi(makeExam());
    await renderExamPage();
    for (let order = 1; order <= 13; order++) {
      const card = screen.getByTestId(`oral-qcard-${order}`);
      // The complete wording is rendered inside the card …
      expect(
        within(card).getByText(`Vollständige Fragestellung Nummer ${order} mit mehreren Wörtern?`),
      ).toBeTruthy();
      // … alongside the id, which is no longer the only identifier.
      expect(within(card).getByText(`T-${String(order).padStart(2, "0")}`)).toBeTruthy();
    }
  });

  it("shows each question's theme and rating", async () => {
    mockApi(makeExam());
    await renderExamPage();
    for (let order = 1; order <= 13; order++) {
      const card = screen.getByTestId(`oral-qcard-${order}`);
      expect(within(card).getByText(`Frage ${order}`)).toBeTruthy();
      expect(within(card).getByText(THEMES[(order - 1) % THEMES.length])).toBeTruthy();
      const expected = (["Richtig", "Teilweise richtig", "Falsch"] as const)[(order - 1) % 3];
      expect(within(card).getByTestId(`oral-qcard-rating-${order}`).textContent).toContain(expected);
    }
  });

  it("shows the documented answer and marks the undocumented ones", async () => {
    mockApi(makeExam());
    await renderExamPage();
    // Questions 3, 6, 9, 12 have no answer (i % 3 === 2).
    const missing = [3, 6, 9, 12];
    for (let order = 1; order <= 13; order++) {
      const card = screen.getByTestId(`oral-qcard-${order}`);
      if (missing.includes(order)) {
        expect(within(card).getByText("Keine Antwort dokumentiert.")).toBeTruthy();
      } else {
        expect(within(card).getByText(`Dokumentierte Antwort ${order}`)).toBeTruthy();
      }
    }
  });

  it("shows the examiner comment only when one was stored", async () => {
    mockApi(makeExam());
    await renderExamPage();
    // Questions 1, 5, 9, 13 have no comment (i % 4 === 0).
    const withoutNote = [1, 5, 9, 13];
    for (let order = 1; order <= 13; order++) {
      if (withoutNote.includes(order)) {
        expect(screen.queryByTestId(`oral-qcard-note-${order}`)).toBeNull();
      } else {
        const note = screen.getByTestId(`oral-qcard-note-${order}`);
        expect(note.textContent).toContain(`Prüferkommentar ${order}`);
      }
    }
  });

  it("offers the Musterlösung collapsed per question", async () => {
    mockApi(makeExam());
    await renderExamPage();
    for (let order = 1; order <= 13; order++) {
      const solution = screen.getByTestId(`oral-solution-${order}`) as HTMLDetailsElement;
      expect(solution).toBeTruthy();
      // Collapsed by default: post-exam review, not a spoiler during the exam.
      expect(solution.open).toBe(false);
      expect(solution.textContent).toContain("Musterlösung anzeigen");
      expect(solution.textContent).toContain(`Musterlösung Nummer ${order}`);
    }
  });

  it("keeps the questions in the stored order", async () => {
    mockApi(makeExam());
    await renderExamPage();
    const list = screen.getByText("Gestellte Prüfungsfragen (13)").closest("details")!;
    const cards = within(list).getAllByTestId(/^oral-qcard-\d+$/);
    const orders = cards.map((c) => Number(c.getAttribute("data-testid")!.split("-").pop()));
    expect(orders).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  });

  it("does not leak the Musterlösung into a running (not completed) exam", async () => {
    mockApi(makeExam({ status: "in_progress", result: null, completedAt: null }));
    await renderExamPage();
    // The result view is not mounted at all, so no solution accordion exists.
    expect(screen.queryByText("Gestellte Prüfungsfragen (13)")).toBeNull();
    expect(screen.queryByText(/^Musterlösung anzeigen$/)).toBeNull();
  });

  it("still shows the overall percent with two decimals", async () => {
    mockApi(makeExam());
    await renderExamPage();
    expect(screen.getByTestId("oral-overall-percent").textContent).toBe("77,50 %");
  });
});
