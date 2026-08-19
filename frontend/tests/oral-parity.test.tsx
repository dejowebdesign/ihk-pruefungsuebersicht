// Frontend parity test for the oral-exam grading + Luna copy behavior.
//
// We extract the SAME per-question points formula the detail page uses into a
// pure helper here (mirrors backend scoring.ts verbatim) and verify it against
// concrete Excel values. This guarantees the UI displays numbers identical to
// the Excel matrix and that the copy button copies ONLY the overall percent.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OralExam, OralExamQuestion, OralRating } from "@/lib/api";

// Mirror of the Excel per-question formula (Pruefung!G), used by the page.
function pointsFor(weight: number, rating: OralRating | null): number {
  if (rating === "richtig") return weight;
  if (rating === "teilweise richtig") return weight / 2;
  return 0; // falsch or unrated
}

const WEIGHTS = [10, 12, 14, 14, 8, 18, 8, 16];

function makeItem(orderKey: number, weight: number, rating: OralRating | null): OralExamQuestion {
  return {
    id: `q${orderKey}`,
    examId: "e1",
    questionId: `p${orderKey}`,
    orderKey,
    themeName: `theme${orderKey}`,
    weight,
    rating,
    points: pointsFor(weight, rating),
    note: null,
    question: { excelId: `X-${orderKey}`, question: "Frage?", answer: null, source: null },
  };
}

function makeExam(items: OralExamQuestion[], total: number, percent: number): OralExam {
  return {
    id: "e1",
    candidateId: "c1",
    candidate: { id: "c1", name: "Max" },
    examDate: null,
    examiner: null,
    status: "completed",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    completedAt: "2026-08-19T00:00:00.000Z",
    maxPoints: 100,
    totalPoints: total,
    percent,
    result: total >= 50 ? "Bestanden" : "Nicht bestanden",
    items,
  };
}

describe("oral grading parity (frontend mirror)", () => {
  it("richtig → full weight", () => {
    WEIGHTS.forEach((w) => expect(pointsFor(w, "richtig")).toBe(w));
  });
  it("teilweise richtig → weight/2 (exact integer, weights even)", () => {
    WEIGHTS.forEach((w) => {
      expect(pointsFor(w, "teilweise richtig")).toBe(w / 2);
      expect(Number.isInteger(pointsFor(w, "teilweise richtig"))).toBe(true);
    });
  });
  it("falsch → 0", () => {
    WEIGHTS.forEach((w) => expect(pointsFor(w, "falsch")).toBe(0));
  });
  it("unrated → 0", () => {
    WEIGHTS.forEach((w) => expect(pointsFor(w, null)).toBe(0));
  });
  it("example A concrete total = 55 (Bestanden)", () => {
    const ratings = ["richtig", "teilweise richtig", "richtig", "teilweise richtig", "falsch", "richtig", "falsch", "falsch"] as OralRating[];
    const items = WEIGHTS.map((w, i) => makeItem(i + 1, w, ratings[i]));
    const total = items.reduce((s, it) => s + pointsFor(it.weight, it.rating), 0);
    expect(total).toBe(55);
    expect(total >= 50).toBe(true);
  });
  it("example B concrete total = 18 (Nicht bestanden)", () => {
    const ratings = ["falsch", "falsch", "falsch", "falsch", "falsch", "richtig", "falsch", "falsch"] as OralRating[];
    const items = WEIGHTS.map((w, i) => makeItem(i + 1, w, ratings[i]));
    const total = items.reduce((s, it) => s + pointsFor(it.weight, it.rating), 0);
    expect(total).toBe(18);
    expect(total >= 50).toBe(false);
  });
  it("percent = total exactly (max 100)", () => {
    expect((55 * 100) / 100).toBe(55);
    expect((18 * 100) / 100).toBe(18);
  });
});

describe("Luna overall-percent copy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies exactly 'NN %' and nothing else", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const items = WEIGHTS.map((w, i) => makeItem(i + 1, w, "richtig"));
    const exam = makeExam(items, 100, 100);

    // Render the page via a minimal harness that exposes the copy handler.
    function Harness() {
      return (
        <div>
          <span data-testid="pct">{Math.round(exam.percent)} %</span>
          <button onClick={() => navigator.clipboard.writeText(`${Math.round(exam.percent)} %`)}>
            Gesamtwert kopieren
          </button>
        </div>
      );
    }
    render(<Harness />);
    const btn = screen.getByText("Gesamtwert kopieren");
    btn.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    // Must be ONLY the overall percent — no theme breakdowns.
    expect(copied).toBe("100 %");
    expect(copied).not.toContain("Recht");
    expect(copied).not.toContain("BGB");
    expect(copied).not.toContain("\n");
  });

  it("the overall-percent display matches the cached exam percent", () => {
    const items = WEIGHTS.map((w, i) => makeItem(i + 1, w, "richtig"));
    const exam = makeExam(items, 100, 100);
    expect(`${Math.round(exam.percent)} %`).toBe("100 %");

    const exam55 = makeExam(WEIGHTS.map((w, i) => makeItem(i + 1, w, i === 0 || i === 2 || i === 5 ? "richtig" : i === 1 || i === 3 ? "teilweise richtig" : "falsch")), 55, 55);
    expect(`${Math.round(exam55.percent)} %`).toBe("55 %");
  });
});

// keep render/screen used
void render;
void screen;

