// Tests for random exam question selection.
//
// Verifies the exam structure: 13 questions, one base question per each of
// the 9 Themenbereiche, 4 extra questions over 4 distinct non-UVV themes,
// at most 2 questions per theme, exactly 1 UVV question, no duplicates,
// theme order preserved, and a seeded RNG is deterministic.

import { describe, it, expect } from "vitest";
import { drawExam, groupByTheme, mulberry32, type PoolQuestion } from "../src/oral/randomize";
import {
  ORAL_THEMES,
  ORAL_QUESTIONS_PER_EXAM,
  ORAL_UVV_THEME,
  ORAL_MAX_PER_THEME,
  ORAL_TOTAL_WEIGHT,
} from "../src/oral/themes";

// Build a synthetic pool: 6 questions per theme with stable ids.
function syntheticPool(): PoolQuestion[] {
  const pool: PoolQuestion[] = [];
  for (const t of ORAL_THEMES) {
    for (let i = 1; i <= 6; i++) {
      pool.push({ id: `${t.orderKey}-${i}`, excelId: `${t.name.slice(0, 3)}-${i}`, themeName: t.name });
    }
  }
  return pool;
}

describe("oral randomize", () => {
  const pool = syntheticPool();
  const perTheme = groupByTheme(pool);

  it("draws exactly 13 questions", () => {
    const slots = drawExam(mulberry32(1), perTheme);
    expect(slots.length).toBe(ORAL_QUESTIONS_PER_EXAM);
    expect(slots.length).toBe(13);
  });

  it("covers all 9 Themenbereiche (no theme missing)", () => {
    const slots = drawExam(mulberry32(3), perTheme);
    const themeSet = new Set(slots.map((s) => s.themeName));
    expect(themeSet.size).toBe(ORAL_THEMES.length);
    expect(themeSet.size).toBe(9);
    for (const t of ORAL_THEMES) expect(themeSet.has(t.name)).toBe(true);
  });

  it("has exactly one UVV question (never two)", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const slots = drawExam(mulberry32(seed), perTheme);
      const uv = slots.filter((s) => s.themeName === ORAL_UVV_THEME);
      expect(uv.length).toBe(1);
    }
  });

  it("never gives a theme more than 2 questions", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const slots = drawExam(mulberry32(seed), perTheme);
      const counts = new Map<string, number>();
      for (const s of slots) counts.set(s.themeName, (counts.get(s.themeName) ?? 0) + 1);
      for (const [name, n] of counts) expect(n, name).toBeLessThanOrEqual(ORAL_MAX_PER_THEME);
    }
  });

  it("exactly 4 themes receive a 2nd question (9 + 4 = 13)", () => {
    const slots = drawExam(mulberry32(7), perTheme);
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.themeName, (counts.get(s.themeName) ?? 0) + 1);
    const doubled = [...counts.values()].filter((n) => n === 2);
    expect(doubled.length).toBe(4);
    // all doubled themes are non-UVV
    for (const [name, n] of counts) if (n === 2) expect(name).not.toBe(ORAL_UVV_THEME);
  });

  it("preserves base theme order (orderKey 1..9 = theme order); extras are 10..13", () => {
    const slots = drawExam(mulberry32(2), perTheme);
    expect(slots.map((s) => s.orderKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(slots.slice(0, 9).map((s) => s.themeName)).toEqual(ORAL_THEMES.map((t) => t.name));
  });

  it("per-question weights sum to 100 in every exam", () => {
    for (const seed of [1, 5, 12, 40]) {
      const slots = drawExam(mulberry32(seed), perTheme);
      expect(slots.reduce((a, s) => a + s.weight, 0)).toBe(ORAL_TOTAL_WEIGHT);
      expect(slots.reduce((a, s) => a + s.weight, 0)).toBe(100);
    }
  });

  it("doubled themes split their weight in half; single themes keep it", () => {
    const slots = drawExam(mulberry32(4), perTheme);
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.themeName, (counts.get(s.themeName) ?? 0) + 1);
    for (const s of slots) {
      const theme = ORAL_THEMES.find((t) => t.name === s.themeName)!;
      const expected = theme.weight / (counts.get(s.themeName) ?? 1);
      expect(s.weight, `${s.themeName}`).toBe(expected);
    }
  });

  it("no duplicate question ids within an exam", () => {
    for (const seed of [1, 2, 3, 9, 33]) {
      const slots = drawExam(mulberry32(seed), perTheme);
      const ids = slots.map((s) => s.questionId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("two different seeds produce different question sets (when pool allows)", () => {
    const a = drawExam(mulberry32(11), perTheme);
    const b = drawExam(mulberry32(99), perTheme);
    const idsA = a.map((s) => s.questionId).sort();
    const idsB = b.map((s) => s.questionId).sort();
    expect(JSON.stringify(idsA)).not.toEqual(JSON.stringify(idsB));
  });

  it("consecutive exams with avoid-set differ (avoid previous ids when possible)", () => {
    const first = drawExam(mulberry32(7), perTheme);
    const avoid = new Set(first.map((s) => s.questionId));
    const second = drawExam(mulberry32(8), perTheme, avoid);
    const secondIds = new Set(second.map((s) => s.questionId));
    for (const id of avoid) expect(secondIds.has(id)).toBe(false);
  });

  it("falls back to full pool when avoid-set covers everything", () => {
    const all = new Set(pool.map((q) => q.id));
    const slots = drawExam(mulberry32(1), perTheme, all);
    expect(slots.length).toBe(13);
    expect(new Set(slots.map((s) => s.questionId)).size).toBe(13);
  });

  it("same seed => identical selection (reproducible tests)", () => {
    const a = drawExam(mulberry32(42), perTheme);
    const b = drawExam(mulberry32(42), perTheme);
    expect(a.map((s) => s.questionId)).toEqual(b.map((s) => s.questionId));
  });

  it("throws when a theme has no questions (cannot satisfy structure)", () => {
    const empty = new Map<string, PoolQuestion[]>();
    for (const t of ORAL_THEMES) empty.set(t.name, []);
    expect(() => drawExam(mulberry32(1), empty)).toThrow();
  });

  it("throws when fewer than 4 non-UVV themes can supply a 2nd question", () => {
    // Only 1 question per theme => no theme can supply a 2nd question.
    const thin = new Map<string, PoolQuestion[]>();
    for (const t of ORAL_THEMES) {
      thin.set(t.name, [{ id: `${t.orderKey}-1`, excelId: `${t.orderKey}-1`, themeName: t.name }]);
    }
    expect(() => drawExam(mulberry32(1), thin)).toThrow();
  });

  it("groupByTheme groups by theme name", () => {
    const m = groupByTheme(pool);
    expect(m.size).toBe(9);
    for (const t of ORAL_THEMES) {
      expect(m.get(t.name)?.length).toBe(6);
    }
  });
});
