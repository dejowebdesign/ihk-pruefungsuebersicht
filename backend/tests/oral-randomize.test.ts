// Tests for random exam question selection.
//
// Verifies the Excel structure is preserved (8 questions, one per theme,
// theme order, no duplicates), consecutive exams differ when possible, and
// a seeded RNG is deterministic for reproducible tests.

import { describe, it, expect } from "vitest";
import { drawExam, groupByTheme, mulberry32, type PoolQuestion } from "../src/oral/randomize";
import { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM } from "../src/oral/themes";

// Build a synthetic pool: 5 questions per theme with stable ids.
function syntheticPool(): PoolQuestion[] {
  const pool: PoolQuestion[] = [];
  for (const t of ORAL_THEMES) {
    for (let i = 1; i <= 5; i++) {
      pool.push({ id: `${t.orderKey}-${i}`, excelId: `${t.name.slice(0, 3)}-${i}`, themeName: t.name });
    }
  }
  return pool;
}

describe("oral randomize", () => {
  const pool = syntheticPool();
  const perTheme = groupByTheme(pool);

  it("draws exactly 8 questions (Excel: one per Themenbereich)", () => {
    const rng = mulberry32(1);
    const slots = drawExam(rng, perTheme);
    expect(slots.length).toBe(ORAL_QUESTIONS_PER_EXAM);
    expect(slots.length).toBe(8);
  });

  it("preserves theme order (1..8, matching Excel Pruefung row order)", () => {
    const slots = drawExam(mulberry32(2), perTheme);
    expect(slots.map((s) => s.orderKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(slots.map((s) => s.themeName)).toEqual(ORAL_THEMES.map((t) => t.name));
  });

  it("one question per theme (no theme missing, no theme repeated)", () => {
    const slots = drawExam(mulberry32(3), perTheme);
    const themeSet = new Set(slots.map((s) => s.themeName));
    expect(themeSet.size).toBe(8);
    for (const t of ORAL_THEMES) expect(themeSet.has(t.name)).toBe(true);
  });

  it("weights snapshot matches Excel weights", () => {
    const slots = drawExam(mulberry32(4), perTheme);
    expect(slots.map((s) => s.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
    expect(slots.reduce((a, s) => a + s.weight, 0)).toBe(100);
  });

  it("no duplicate question ids within an exam", () => {
    const slots = drawExam(mulberry32(5), perTheme);
    const ids = slots.map((s) => s.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("two different seeds produce different question sets (when pool allows)", () => {
    const a = drawExam(mulberry32(11), perTheme);
    const b = drawExam(mulberry32(99), perTheme);
    const idsA = a.map((s) => s.questionId).sort();
    const idsB = b.map((s) => s.questionId).sort();
    // Extremely unlikely to coincide with 5 per theme; assert they differ.
    expect(JSON.stringify(idsA)).not.toEqual(JSON.stringify(idsB));
  });

  it("consecutive exams with avoid-set differ (avoid previous ids when possible)", () => {
    const rng = mulberry32(7);
    const first = drawExam(rng, perTheme);
    const avoid = new Set(first.map((s) => s.questionId));
    const second = drawExam(mulberry32(8), perTheme, avoid);
    const secondIds = new Set(second.map((s) => s.questionId));
    // None of the second's ids should be in the avoid set (5 per theme ⇒ possible).
    for (const id of avoid) expect(secondIds.has(id)).toBe(false);
  });

  it("falls back to full pool when avoid-set covers everything", () => {
    // avoid all ids → must still return a valid 8-question exam
    const all = new Set(pool.map((q) => q.id));
    const slots = drawExam(mulberry32(1), perTheme, all);
    expect(slots.length).toBe(8);
    expect(new Set(slots.map((s) => s.questionId)).size).toBe(8);
  });

  it("same seed ⇒ identical selection (reproducible tests)", () => {
    const a = drawExam(mulberry32(42), perTheme);
    const b = drawExam(mulberry32(42), perTheme);
    expect(a.map((s) => s.questionId)).toEqual(b.map((s) => s.questionId));
  });

  it("throws when a theme has no questions (cannot satisfy structure)", () => {
    const empty = new Map<string, PoolQuestion[]>();
    for (const t of ORAL_THEMES) empty.set(t.name, []);
    expect(() => drawExam(mulberry32(1), empty)).toThrow();
  });

  it("groupByTheme groups by theme name", () => {
    const m = groupByTheme(pool);
    expect(m.size).toBe(8);
    for (const t of ORAL_THEMES) {
      expect(m.get(t.name)?.length).toBe(5);
    }
  });
});
