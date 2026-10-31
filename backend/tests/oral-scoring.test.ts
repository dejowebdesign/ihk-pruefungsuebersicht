// Phase 11 — weighted PERCENTAGE scoring.
//
// Every expected value below is derived from the spec's own examples
// (18/18/18/10/9/9/9/9 = 100 %, pass at 50 %), not from the implementation.

import { describe, expect, it } from "vitest";
import {
  scoreExam,
  questionFactor,
  passResult,
  ORAL_PASS_PERCENT,
  scoreExamLegacy,
  type Rating,
} from "../src/oral/scoring";
import { ORAL_THEMES, ORAL_TOTAL_WEIGHT } from "../src/oral/themes";

const BGB = "Buergerliches Gesetzbuch / Jedermannsrechte";
const STGB = "Straf- und Verfahrensrecht";
const UMM = "Umgang mit Menschen / Deeskalation";
const RD = "Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht";
const DS = "Datenschutzrecht";
const UVV = "Unfallverhuetungsvorschriften";
const WAF = "Umgang mit Waffen";
const SST = "Grundlagen der Sicherheitstechnik";

const W: Record<string, number> = {
  [BGB]: 18,
  [STGB]: 18,
  [UMM]: 18,
  [RD]: 10,
  [DS]: 9,
  [UVV]: 9,
  [WAF]: 9,
  [SST]: 9,
};

/** One exam: 2 questions from each main theme, 1 from each other theme. */
function items(ratingOf: (theme: string, index: number) => Rating | null) {
  const out: Array<{ themeName: string; weight: number; rating: Rating | null }> = [];
  for (const t of ORAL_THEMES) {
    const count = t.questionsPerExam;
    for (let i = 0; i < count; i++) {
      out.push({ themeName: t.name, weight: W[t.name], rating: ratingOf(t.name, i) });
    }
  }
  return out;
}

const all = (r: Rating | null) => () => r;
/** Only `theme` correct, everything else wrong. */
const only = (theme: string) => (t: string) => (t === theme ? "richtig" : "falsch");

describe("weight configuration", () => {
  it("has exactly 8 themes", () => {
    expect(ORAL_THEMES).toHaveLength(8);
  });

  it("sums to exactly 100 %", () => {
    expect(ORAL_TOTAL_WEIGHT).toBe(100);
  });

  it("uses the required weights per theme", () => {
    expect(Object.fromEntries(ORAL_THEMES.map((t) => [t.name, t.weight]))).toEqual(W);
  });

  it("has no duplicate theme name or orderKey", () => {
    expect(new Set(ORAL_THEMES.map((t) => t.name)).size).toBe(8);
    expect(new Set(ORAL_THEMES.map((t) => t.orderKey)).size).toBe(8);
  });

  it("draws exactly 2 questions from each main theme and 1 from each other", () => {
    expect(ORAL_THEMES.filter((t) => t.questionsPerExam === 2).map((t) => t.name)).toEqual([
      BGB,
      STGB,
      UMM,
      RD,
    ]);
    expect(ORAL_THEMES.filter((t) => t.questionsPerExam === 1).map((t) => t.name)).toEqual([
      DS,
      UVV,
      WAF,
      SST,
    ]);
  });
});

describe("rating factors (B1: 100 / 50 / 0 %)", () => {
  it("maps the three levels to 1 / 0.5 / 0", () => {
    expect(questionFactor("richtig")).toBe(1);
    expect(questionFactor("teilweise richtig")).toBe(0.5);
    expect(questionFactor("falsch")).toBe(0);
  });

  it("treats an unanswered question as wrong", () => {
    expect(questionFactor(null)).toBe(0);
    expect(questionFactor(undefined)).toBe(0);
  });
});

describe("all questions correct", () => {
  it("is exactly 100 %", () => {
    expect(scoreExam(items(all("richtig"))).percent).toBe(100);
  });
  it("passes", () => {
    expect(scoreExam(items(all("richtig"))).result).toBe("Bestanden");
  });
});

describe("only one theme fully correct (spec 10.2)", () => {
  it.each([
    [BGB, 18],
    [STGB, 18],
    [UMM, 18],
    [RD, 10],
    [DS, 9],
    [UVV, 9],
    [WAF, 9],
    [SST, 9],
  ])("only %s correct = %i %%", (theme, expected) => {
    expect(scoreExam(items(only(theme))).percent).toBe(expected);
  });
});

describe("partial results in the main themes (2 questions each)", () => {
  it.each([
    [BGB, 18],
    [STGB, 18],
    [UMM, 18],
    [RD, 10],
  ])("1 of 2 correct in %s = half the weight (%i %%)", (theme, weight) => {
    const s = scoreExam(items((t, i) => (t === theme ? (i === 0 ? "richtig" : "falsch") : "falsch")));
    expect(s.percent).toBe(weight / 2);
  });

  it("1 correct + 1 teilweise richtig in BGB = 13.5 %", () => {
    const s = scoreExam(
      items((t, i) => (t === BGB ? (i === 0 ? "richtig" : "teilweise richtig") : "falsch")),
    );
    expect(s.percent).toBe(13.5);
  });

  it("both teilweise richtig in BGB = 9 %", () => {
    const s = scoreExam(items((t) => (t === BGB ? "teilweise richtig" : "falsch")));
    expect(s.percent).toBe(9);
  });
});

describe("a theme asked twice keeps the same weight as when asked once", () => {
  it("Datenschutz with 2 questions, both correct = 9 % (not 18 %)", () => {
    const base = items(all("falsch"));
    base.push({ themeName: DS, weight: W[DS], rating: "richtig" });
    const s = scoreExam(base.map((b) => (b.themeName === DS ? { ...b, rating: "richtig" } : b)));
    expect(s.percent).toBe(9);
  });

  it("Datenschutz with 2 questions, 1 of 2 correct = 4.5 %", () => {
    const base = items(all("falsch"));
    base.push({ themeName: DS, weight: W[DS], rating: "richtig" });
    let first = true;
    const s = scoreExam(
      base.map((b) => {
        if (b.themeName !== DS) return b;
        if (first) {
          first = false;
          return { ...b, rating: "richtig" };
        }
        return { ...b, rating: "falsch" };
      }),
    );
    expect(s.percent).toBe(4.5);
  });

  it.each([[UVV], [WAF], [SST]])("%s with 2 questions, 1 of 2 correct = 4.5 %%", (theme) => {
    const base = items(all("falsch"));
    base.push({ themeName: theme as string, weight: 9, rating: "falsch" });
    let first = true;
    const s = scoreExam(
      base.map((b) => {
        if (b.themeName !== theme) return b;
        if (first) {
          first = false;
          return { ...b, rating: "richtig" };
        }
        return { ...b, rating: "falsch" };
      }),
    );
    expect(s.percent).toBe(4.5);
  });
});

describe("breakdown", () => {
  it("reports one entry per asked theme with percent and contribution", () => {
    const s = scoreExam(items(all("richtig")));
    expect(s.themes).toHaveLength(8);
    for (const t of s.themes) {
      expect(t.percent).toBe(100);
      expect(t.contribution).toBe(t.weight);
    }
  });

  it("contributions sum exactly to the overall result", () => {
    const s = scoreExam(items((t, i) => (i === 0 ? "richtig" : "teilweise richtig")));
    const sum = s.themes.reduce((a, b) => a + b.contribution, 0);
    expect(sum).toBe(s.percent);
  });

  it("records how many questions were asked per theme", () => {
    const s = scoreExam(items(all("richtig")));
    const byName = Object.fromEntries(s.themes.map((t) => [t.themeName, t.asked]));
    expect(byName[BGB]).toBe(2);
    expect(byName[DS]).toBe(1);
  });
});

describe("pass mark (50 % transferred 1:1 from 50 of 100 points)", () => {
  it("is 50", () => {
    expect(ORAL_PASS_PERCENT).toBe(50);
  });
  it.each([
    [49.99, "Nicht bestanden"],
    [50, "Bestanden"],
    [50.01, "Bestanden"],
    [0, "Nicht bestanden"],
    [100, "Bestanden"],
  ])("%s %% -> %s", (pct, expected) => {
    expect(passResult(pct)).toBe(expected);
  });
});

describe("no premature rounding", () => {
  it("keeps 4.5 and 13.5 exact", () => {
    const base = items(all("falsch"));
    base.push({ themeName: DS, weight: 9, rating: "richtig" });
    let first = true;
    const s = scoreExam(
      base.map((b) => {
        if (b.themeName !== DS) return b;
        if (first) {
          first = false;
          return { ...b, rating: "richtig" };
        }
        return { ...b, rating: "falsch" };
      }),
    );
    expect(s.percent).toBe(4.5);
    expect(Number.isInteger(s.percent * 2)).toBe(true);
  });

  it("a realistic mixed exam is exact", () => {
    // BGB 2/2, StGB 1/2, UmM 1/2 + 1 teilweise, RdO 2/2, DS 1/1,
    // UVV 0/1, Waffen 1/1, SST 1/1
    const ratings: Record<string, Array<Rating | null>> = {
      [BGB]: ["richtig", "richtig"],
      [STGB]: ["richtig", "falsch"],
      [UMM]: ["richtig", "teilweise richtig"],
      [RD]: ["richtig", "richtig"],
      [DS]: ["richtig"],
      [UVV]: ["falsch"],
      [WAF]: ["richtig"],
      [SST]: ["richtig"],
    };
    const s = scoreExam(items((t, i) => ratings[t][i]));
    // 18 + 9 + (1.5/2)*18=13.5 + 10 + 9 + 0 + 9 + 9 = 77.5
    expect(s.percent).toBe(77.5);
    expect(s.result).toBe("Bestanden");
  });
});

describe("legacy points scorer is retained for historical exams", () => {
  it("still computes the old points/percent", () => {
    const s = scoreExamLegacy([
      { weight: 8, rating: "richtig" },
      { weight: 8, rating: "teilweise richtig" },
      { weight: 8, rating: "falsch" },
    ]);
    expect(s.totalPoints).toBe(12);
    expect(s.percent).toBe(12);
  });
});
