// Random question selection for a new oral exam.
//
// The ONLY deliberate deviation from the Excel workbook: instead of a fixed
// question per Prüfling, we draw a fresh random question per Themenbereich.
// The Excel structure (8 questions, one per theme, theme order preserved) is
// kept exactly — only the concrete question drawn per theme varies.
//
// Constraints enforced:
//   - exactly 1 question per theme (8 total),
//   - theme order preserved,
//   - no duplicate question ids within an exam (guaranteed since themes are
//     disjoint),
//   - consecutive exams should differ when the pool allows it.
//
// A pluggable RNG (`() => number` in [0,1)) makes selection deterministic in
// tests and truly random in production.

import type { OralThemeDef } from "./themes";
import { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM } from "./themes";

export interface PoolQuestion {
  id: string;
  excelId: string;
  themeName: string;
}

export interface ExamSlot {
  orderKey: number;
  themeName: string;
  weight: number;
  questionId: string;
  excelId: string;
}

export type Rng = () => number;

/** Mulberry32 — small, fast, deterministic PRNG for seeded tests. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates pick of one index in [0, n) using the given RNG. */
function pickIndex(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/**
 * Build an exam slot list: one question per theme, theme order preserved.
 * `pool` must be grouped/supplied per theme (only questions of that theme).
 * Throws if a theme has no questions (cannot satisfy the structure).
 *
 * @param rng          random source (production: Math.random; tests: seeded)
 * @param perTheme     map: themeName -> questions of that theme
 * @param avoidIds     optional set of question ids to avoid (used to make
 *                     consecutive exams differ when possible)
 */
export function drawExam(
  rng: Rng,
  perTheme: ReadonlyMap<string, PoolQuestion[]>,
  avoidIds?: ReadonlySet<string>,
): ExamSlot[] {
  const slots: ExamSlot[] = [];
  for (const theme of ORAL_THEMES) {
    const pool = perTheme.get(theme.name) ?? [];
    if (pool.length === 0) {
      throw new Error(`oral exam: no questions available for theme "${theme.name}"`);
    }
    // Prefer questions not in the avoid-set (so consecutive exams differ),
    // but fall back to the full pool if all are to be avoided.
    let candidates = pool;
    if (avoidIds && avoidIds.size > 0) {
      const filtered = pool.filter((q) => !avoidIds.has(q.id));
      candidates = filtered.length > 0 ? filtered : pool;
    }
    const q = candidates[pickIndex(rng, candidates.length)];
    slots.push({
      orderKey: theme.orderKey,
      themeName: theme.name,
      weight: theme.weight,
      questionId: q.id,
      excelId: q.excelId,
    });
  }
  return slots;
}

/** Build the per-theme map required by drawExam from a flat question list. */
export function groupByTheme(questions: ReadonlyArray<PoolQuestion>): Map<string, PoolQuestion[]> {
  const m = new Map<string, PoolQuestion[]>();
  for (const q of questions) {
    const arr = m.get(q.themeName) ?? [];
    arr.push(q);
    m.set(q.themeName, arr);
  }
  return m;
}

export { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM };
export type { OralThemeDef };
