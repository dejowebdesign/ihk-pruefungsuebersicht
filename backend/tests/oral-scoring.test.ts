// Excel-parity tests for the oral exam scoring logic.
//
// These tests verify the Web app reproduces the EXACT results of the Excel
// matrix `Pruefungsmatrix_muendliche_Pruefung_34a_vereinfacht_mit_Antworten.xlsx`
// for concrete evaluation combinations. They are the single source of truth
// for "Bewertungslogik 1:1".
//
// Reference (Pruefung sheet + W1 decision):
//   theme weights = 8,12,12,12,8,16,8,16,8  (sum 100)
//   G = richtig→B, teilweise richtig→B/2, falsch→0
//   G18 = SUM(G8:G15), G19 = G18/100, G20 = G18>=50 ? "Bestanden" : "Nicht bestanden"

import { describe, it, expect } from "vitest";
import {
  questionPoints,
  totalPoints,
  percentValue,
  passResult,
  scoreExam,
  ORAL_MAX_POINTS,
  ORAL_PASS_THRESHOLD,
  RATINGS,
} from "../src/oral/scoring";
import { ORAL_THEMES } from "../src/oral/themes";

const WEIGHTS = ORAL_THEMES.map((t) => t.weight); // [8,12,12,12,8,16,8,16,8]

describe("oral scoring — Excel parity", () => {
  describe("Bewertungsstufen 1:1", () => {
    it("exposes exactly the 3 Excel rating levels with exact labels", () => {
      expect(RATINGS).toEqual(["richtig", "teilweise richtig", "falsch"]);
    });

    it("richtig → full weight (Excel: B)", () => {
      for (const w of WEIGHTS) {
        expect(questionPoints(w, "richtig")).toBe(w);
      }
    });

    it("teilweise richtig → half weight (Excel: B/2), exact integer because all weights even", () => {
      const expected = [4, 6, 6, 6, 4, 8, 4, 8, 4];
      WEIGHTS.forEach((w, i) => {
        expect(questionPoints(w, "teilweise richtig")).toBe(w / 2);
        expect(questionPoints(w, "teilweise richtig")).toBe(expected[i]);
        // no fractional remainder — Excel format '0.0' shows clean .0
        expect(Number.isInteger(questionPoints(w, "teilweise richtig"))).toBe(true);
      });
    });

    it("falsch → 0 (Excel third branch)", () => {
      for (const w of WEIGHTS) {
        expect(questionPoints(w, "falsch")).toBe(0);
      }
    });

    it("unrated (null) → 0, matching Excel's empty/'' branch", () => {
      for (const w of WEIGHTS) {
        expect(questionPoints(w, null)).toBe(0);
        expect(questionPoints(w, undefined)).toBe(0);
      }
    });
  });

  describe("Punkteberechnung 1:1 (G18 = SUM)", () => {
    it("all richtig → 100 points (sum of all weights)", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "richtig" as const }));
      expect(totalPoints(items)).toBe(100);
    });

    it("all falsch → 0 points", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "falsch" as const }));
      expect(totalPoints(items)).toBe(0);
    });

    it("all teilweise richtig → 50 (sum of weight/2)", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "teilweise richtig" as const }));
      expect(totalPoints(items)).toBe(50);
    });

    it("mixed concrete example A: richtig on 1,3,6; teilweise on 2,4; falsch on rest", () => {
      // richtig: 8+12+16 = 36 ; teilweise: 6+6 = 12 ; falsch: 0  → 48
      const ratings = ["richtig", "teilweise richtig", "richtig", "teilweise richtig", "falsch", "richtig", "falsch", "falsch", "falsch"] as const;
      const items = WEIGHTS.map((w, i) => ({ weight: w, rating: ratings[i] }));
      expect(totalPoints(items)).toBe(48);
    });

    it("mixed concrete example B: richtig on 6 only, rest falsch → 16", () => {
      const ratings = ["falsch", "falsch", "falsch", "falsch", "falsch", "richtig", "falsch", "falsch", "falsch"] as const;
      const items = WEIGHTS.map((w, i) => ({ weight: w, rating: ratings[i] }));
      expect(totalPoints(items)).toBe(16);
    });
  });

  describe("Prozentberechnung 1:1 (G19 = G18/G17)", () => {
    it("max percent = 100 when all richtig", () => {
      expect(percentValue(100)).toBe(100);
    });

    it("0 percent when all falsch", () => {
      expect(percentValue(0)).toBe(0);
    });

    it("55 points → 55 percent (exact, no rounding)", () => {
      expect(percentValue(55)).toBe(55);
    });

    it("18 points → 18 percent", () => {
      expect(percentValue(18)).toBe(18);
    });

    it("50 points → 50 percent (boundary)", () => {
      expect(percentValue(50)).toBe(50);
    });
  });

  describe("Rundungslogik 1:1", () => {
    it("never produces a fractional total — all weights even ⇒ integer sum", () => {
      // Exhaustive-ish: for every combination of the 3 ratings across 9 themes,
      // the total is an integer. We sample randomly to keep it cheap.
      for (let i = 0; i < 1000; i++) {
        const items = WEIGHTS.map((w) => ({
          weight: w,
          rating: RATINGS[Math.floor(Math.random() * 3)],
        }));
        const t = totalPoints(items);
        expect(Number.isInteger(t)).toBe(true);
      }
    });

    it("percent is always an exact integer (total integer, max 100)", () => {
      for (let i = 0; i < 1000; i++) {
        const items = WEIGHTS.map((w) => ({
          weight: w,
          rating: RATINGS[Math.floor(Math.random() * 3)],
        }));
        expect(Number.isInteger(percentValue(totalPoints(items)))).toBe(true);
      }
    });
  });

  describe("Bestehenslogik 1:1 (G20 = G18>=50)", () => {
    it("exactly 50 → Bestanden (boundary inclusive, matches 'Ab 50 Punkten')", () => {
      expect(passResult(50)).toBe("Bestanden");
    });

    it("49 → Nicht bestanden", () => {
      expect(passResult(49)).toBe("Nicht bestanden");
    });

    it("100 → Bestanden", () => {
      expect(passResult(100)).toBe("Bestanden");
    });

    it("0 → Nicht bestanden", () => {
      expect(passResult(0)).toBe("Nicht bestanden");
    });
  });

  describe("scoreExam — full Excel G18/G19/G20 snapshot", () => {
    it("example A (48 pts) → 48 %, Nicht bestanden", () => {
      const ratings = ["richtig", "teilweise richtig", "richtig", "teilweise richtig", "falsch", "richtig", "falsch", "falsch", "falsch"] as const;
      const items = WEIGHTS.map((w, i) => ({ weight: w, rating: ratings[i] }));
      expect(scoreExam(items)).toEqual({
        maxPoints: 100,
        totalPoints: 48,
        percent: 48,
        result: "Nicht bestanden",
      });
    });

    it("all richtig → 100 %, Bestanden", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "richtig" as const }));
      expect(scoreExam(items)).toEqual({
        maxPoints: 100,
        totalPoints: 100,
        percent: 100,
        result: "Bestanden",
      });
    });

    it("all teilweise richtig → 50 %, Bestanden (boundary)", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "teilweise richtig" as const }));
      expect(scoreExam(items)).toEqual({
        maxPoints: 100,
        totalPoints: 50,
        percent: 50,
        result: "Bestanden",
      });
    });

    it("all falsch → 0 %, Nicht bestanden", () => {
      const items = WEIGHTS.map((w) => ({ weight: w, rating: "falsch" as const }));
      expect(scoreExam(items)).toEqual({
        maxPoints: 100,
        totalPoints: 0,
        percent: 0,
        result: "Nicht bestanden",
      });
    });

    it("example B (16 pts) → 16 %, Nicht bestanden", () => {
      const ratings = ["falsch", "falsch", "falsch", "falsch", "falsch", "richtig", "falsch", "falsch", "falsch"] as const;
      const items = WEIGHTS.map((w, i) => ({ weight: w, rating: ratings[i] }));
      expect(scoreExam(items)).toEqual({
        maxPoints: 100,
        totalPoints: 16,
        percent: 16,
        result: "Nicht bestanden",
      });
    });
  });

  describe("constants", () => {
    it("ORAL_MAX_POINTS = 100 (Excel G17)", () => {
      expect(ORAL_MAX_POINTS).toBe(100);
    });
    it("ORAL_PASS_THRESHOLD = 50 (Excel G20)", () => {
      expect(ORAL_PASS_THRESHOLD).toBe(50);
    });
    it("weights sum to 100", () => {
      expect(WEIGHTS.reduce((a, b) => a + b, 0)).toBe(100);
    });
    it("all weights are divisible by 4 (guarantees weight/2 and weight/4 integers)", () => {
      for (const w of WEIGHTS) expect(w % 4).toBe(0);
    });
  });
});
