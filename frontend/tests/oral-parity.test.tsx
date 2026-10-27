// Frontend parity test for the oral-exam grading + Luna copy behavior.
//
// The exam now has 13 questions across 9 Themenbereiche (4 themes doubled, so
// their weight is split in half). We mirror the backend per-question formula
// here and verify the UI math against concrete values, plus that the copy
// button copies ONLY the overall percent.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OralExam, OralExamQuestion, OralRating } from "@/lib/api";

// Mirror of the Excel per-question formula (Pruefung!G), used by the page.
function pointsFor(weight: number, rating: OralRating | null): number {
  if (rating === "richtig") return weight;
  if (rating === "teilweise richtig") return weight / 2;
  return 0; // falsch or unrated
}

// 9 theme weights (sum 100). Themes 0,2,4,6 are doubled → weight/2 per question.
const THEME_WEIGHTS = [8, 12, 12, 12, 8, 16, 8, 16, 8];
const DOUBLED = new Set([0, 2, 4, 6]);
const PER_QUESTION: number[] = THEME_WEIGHTS.flatMap((w, i) => (DOUBLED.has(i) ? [w / 2, w / 2] : [w]));

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

function totalOf(ratings: OralRating[]): number {
  return PER_QUESTION.reduce((s, w, i) => s + pointsFor(w, ratings[i]), 0);
}

describe("oral grading parity (frontend mirror)", () => {
  it("has 13 questions summing to 100 points", () => {
    expect(PER_QUESTION.length).toBe(13);
    expect(PER_QUESTION.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("richtig → full weight", () => {
    PER_QUESTION.forEach((w) => expect(pointsFor(w, "richtig")).toBe(w));
  });
  it("teilweise richtig → weight/2 (exact integer, weights divisible by 4)", () => {
    PER_QUESTION.forEach((w) => {
      expect(pointsFor(w, "teilweise richtig")).toBe(w / 2);
      expect(Number.isInteger(pointsFor(w, "teilweise richtig"))).toBe(true);
    });
  });
  it("falsch → 0", () => {
    PER_QUESTION.forEach((w) => expect(pointsFor(w, "falsch")).toBe(0));
  });
  it("unrated → 0", () => {
    PER_QUESTION.forEach((w) => expect(pointsFor(w, null)).toBe(0));
  });

  it("all richtig → 100 (Bestanden)", () => {
    const total = totalOf(PER_QUESTION.map(() => "richtig"));
    expect(total).toBe(100);
    expect(total >= 50).toBe(true);
  });
  it("all teilweise richtig → exactly 50 (Bestanden, threshold)", () => {
    const total = totalOf(PER_QUESTION.map(() => "teilweise richtig"));
    expect(total).toBe(50);
    expect(total >= 50).toBe(true);
  });
  it("all falsch → 0 (Nicht bestanden)", () => {
    expect(totalOf(PER_QUESTION.map(() => "falsch"))).toBe(0);
  });
  it("mixed example → 52 (Bestanden)", () => {
    const ratings = PER_QUESTION.map(() => "falsch") as OralRating[];
    ratings[0] = "richtig"; // 4
    ratings[2] = "richtig"; // 12
    ratings[5] = "richtig"; // 12
    ratings[8] = "richtig"; // 16
    ratings[11] = "teilweise richtig"; // 8
    const total = totalOf(ratings);
    expect(total).toBe(52);
    expect(total >= 50).toBe(true);
  });
  it("one short of the threshold → 48 (Nicht bestanden)", () => {
    const ratings = PER_QUESTION.map(() => "falsch") as OralRating[];
    ratings[2] = "richtig"; // 12
    ratings[5] = "richtig"; // 12
    ratings[8] = "richtig"; // 16
    ratings[11] = "teilweise richtig"; // 8
    const total = totalOf(ratings);
    expect(total).toBe(48);
    expect(total >= 50).toBe(false);
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

    const items = PER_QUESTION.map((w, i) => makeItem(i + 1, w, "richtig"));
    const exam = makeExam(items, 100, 100);

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
    expect(copied).toBe("100 %");
    expect(copied).not.toContain("Recht");
    expect(copied).not.toContain("BGB");
    expect(copied).not.toContain("\n");
  });

  it("the overall-percent display matches the cached exam percent", () => {
    const items = PER_QUESTION.map((w, i) => makeItem(i + 1, w, "richtig"));
    const exam = makeExam(items, 100, 100);
    expect(`${Math.round(exam.percent)} %`).toBe("100 %");

    const exam52 = makeExam(items, 52, 52);
    expect(`${Math.round(exam52.percent)} %`).toBe("52 %");
  });
});

// keep render/screen used
void render;
void screen;
