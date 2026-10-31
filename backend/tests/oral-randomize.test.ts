// Phase 11 — exam composition: exactly 13 questions, 8 themes,
// 4x2 main + 4x1 other + 1 rotating 13th.

import { describe, expect, it } from "vitest";
import { drawExam, groupByTheme, mulberry32, type PoolQuestion } from "../src/oral/randomize";
import {
  ORAL_THEMES,
  ORAL_MAIN_THEME_NAMES,
  ORAL_OTHER_THEME_NAMES,
  ORAL_ROTATION_THEMES,
  ORAL_QUESTIONS_PER_EXAM,
  rotationThemeFor,
} from "../src/oral/themes";

/** A pool with `n` questions per theme (unique ids). */
function makePool(n = 6): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  for (const t of ORAL_THEMES) {
    for (let i = 0; i < n; i++) {
      out.push({ id: `${t.name}#${i}`, excelId: `${t.orderKey}-${i}`, themeName: t.name });
    }
  }
  return out;
}

const pool = makePool(6);
const perTheme = groupByTheme(pool);

describe("exam composition", () => {
  it("always yields exactly 13 questions", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = drawExam(mulberry32(seed), perTheme, rotationThemeFor(seed));
      expect(slots).toHaveLength(ORAL_QUESTIONS_PER_EXAM);
      expect(slots).toHaveLength(13);
    }
  });

  it("draws exactly 2 questions from each main theme", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = drawExam(mulberry32(seed), perTheme, rotationThemeFor(seed));
      for (const name of ORAL_MAIN_THEME_NAMES) {
        expect(slots.filter((s) => s.themeName === name)).toHaveLength(2);
      }
    }
  });

  it("draws at least 1 question from each of the 4 other themes", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = drawExam(mulberry32(seed), perTheme, rotationThemeFor(seed));
      for (const name of ORAL_OTHER_THEME_NAMES) {
        expect(slots.filter((s) => s.themeName === name).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("adds the 13th question to the designated rotation theme", () => {
    for (const theme of ORAL_ROTATION_THEMES) {
      const slots = drawExam(mulberry32(7), perTheme, theme);
      expect(slots.filter((s) => s.themeName === theme)).toHaveLength(2);
    }
  });

  it("never exceeds 2 questions for any theme", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = drawExam(mulberry32(seed), perTheme, rotationThemeFor(seed));
      const counts = new Map<string, number>();
      for (const s of slots) counts.set(s.themeName, (counts.get(s.themeName) ?? 0) + 1);
      for (const [, c] of counts) expect(c).toBeLessThanOrEqual(2);
    }
  });

  it("never contains a duplicate question", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = drawExam(mulberry32(seed), perTheme, rotationThemeFor(seed));
      expect(new Set(slots.map((s) => s.questionId)).size).toBe(slots.length);
    }
  });

  it("covers all 8 themes", () => {
    const slots = drawExam(mulberry32(3), perTheme, ORAL_ROTATION_THEMES[0]);
    expect(new Set(slots.map((s) => s.themeName)).size).toBe(8);
  });

  it("numbers the slots 1..13 in order", () => {
    const slots = drawExam(mulberry32(11), perTheme, ORAL_ROTATION_THEMES[1]);
    expect(slots.map((s) => s.orderKey)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("only uses questions that exist in the pool", () => {
    const ids = new Set(pool.map((q) => q.id));
    const slots = drawExam(mulberry32(5), perTheme, ORAL_ROTATION_THEMES[2]);
    for (const s of slots) expect(ids.has(s.questionId)).toBe(true);
  });

  it("snapshots the THEME weight, not a per-question share", () => {
    const slots = drawExam(mulberry32(9), perTheme, ORAL_ROTATION_THEMES[3]);
    for (const s of slots) {
      const def = ORAL_THEMES.find((t) => t.name === s.themeName)!;
      expect(s.weight).toBe(def.weight);
    }
  });
});

describe("fair rotation of the 13th question", () => {
  it("cycles through the 4 rotation themes in order", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(rotationThemeFor)).toEqual([
      ORAL_ROTATION_THEMES[0],
      ORAL_ROTATION_THEMES[1],
      ORAL_ROTATION_THEMES[2],
      ORAL_ROTATION_THEMES[3],
      ORAL_ROTATION_THEMES[0],
      ORAL_ROTATION_THEMES[1],
      ORAL_ROTATION_THEMES[2],
      ORAL_ROTATION_THEMES[3],
    ]);
  });

  it("is evenly distributed over 400 exams", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      const t = rotationThemeFor(i);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const t of ORAL_ROTATION_THEMES) expect(counts.get(t)).toBe(100);
  });
});

describe("insufficient pool fails loudly (never a wrong exam)", () => {
  it("throws when a theme has no questions", () => {
    const missing = new Map(perTheme);
    missing.delete(ORAL_MAIN_THEME_NAMES[0]);
    expect(() => drawExam(mulberry32(1), missing, ORAL_ROTATION_THEMES[0])).toThrow(
      /no questions available/,
    );
  });

  it("throws when a main theme has only one question (needs 2)", () => {
    const thin = new Map<string, PoolQuestion[]>();
    for (const t of ORAL_THEMES) {
      thin.set(t.name, [{ id: `${t.name}#0`, excelId: "x", themeName: t.name }]);
    }
    expect(() => drawExam(mulberry32(1), thin, ORAL_ROTATION_THEMES[0])).toThrow();
  });

  it("throws when the rotation theme has only one question", () => {
    const thin = new Map<string, PoolQuestion[]>();
    for (const t of ORAL_THEMES) {
      const n = t.questionsPerExam;
      thin.set(
        t.name,
        Array.from({ length: n }, (_, i) => ({
          id: `${t.name}#${i}`,
          excelId: "x",
          themeName: t.name,
        })),
      );
    }
    expect(() => drawExam(mulberry32(1), thin, ORAL_ROTATION_THEMES[0])).toThrow(
      /no more unused questions/,
    );
  });
});

describe("avoidIds", () => {
  it("prefers unused questions but still fills all 13 slots", () => {
    const avoid = new Set(pool.slice(0, 20).map((q) => q.id));
    const slots = drawExam(mulberry32(2), perTheme, ORAL_ROTATION_THEMES[0], avoid);
    expect(slots).toHaveLength(13);
    expect(new Set(slots.map((s) => s.questionId)).size).toBe(13);
  });
});
