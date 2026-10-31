// Random question selection for a new oral exam (Phase 11: 8 themes, 13 slots).
//
// Structure (see themes.ts):
//   - exactly 2 questions from EACH of the 4 main Themenbereiche  -> 8 slots,
//   - exactly 1 question  from EACH of the 4 other Themenbereiche -> 4 slots,
//   - a 13th question from ONE of the 4 other themes, given by the persisted
//     rotation (see rotation.ts)                                 -> 1 slot.
//
// Guarantees enforced here (and asserted by the caller/tests):
//   - exactly 13 slots,
//   - no duplicate question id within an exam,
//   - the 4 main themes contribute exactly 2 each,
//   - the 4 other themes contribute at least 1 each,
//   - every question comes from the stored pool (nothing is invented).
//
// If the pool cannot satisfy the distribution without duplicates, drawing
// throws instead of silently producing a wrong exam.
//
// A pluggable RNG (`() => number` in [0,1)) keeps selection deterministic in
// tests and truly random in production.

import type { OralThemeDef } from "./themes";
import {
  ORAL_THEMES,
  ORAL_QUESTIONS_PER_EXAM,
  ORAL_MAX_PER_THEME,
} from "./themes";

export interface PoolQuestion {
  id: string;
  excelId: string;
  themeName: string;
}

export interface ExamSlot {
  orderKey: number; // 1..13
  themeName: string;
  weight: number; // the THEME weight (percent); per-question share = weight/asked
  questionId: string;
  excelId: string;
}

export type Rng = () => number;

/** Mulberry32 - small, fast, deterministic PRNG for seeded tests. */
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

function pickIndex(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/**
 * Build the 13 exam slots.
 *
 * @param rng            random source (production: Math.random; tests: seeded)
 * @param perTheme       map: themeName -> questions of that theme
 * @param rotationTheme  theme of the rotating 13th question (from rotation.ts)
 * @param avoidIds       optional ids to avoid when possible (keeps consecutive
 *                       exams of the same candidate from repeating questions)
 */
export function drawExam(
  rng: Rng,
  perTheme: ReadonlyMap<string, PoolQuestion[]>,
  rotationTheme: string,
  avoidIds?: ReadonlySet<string>,
): ExamSlot[] {
  const used = new Set<string>();

  const poolFor = (themeName: string): PoolQuestion[] => {
    const pool = perTheme.get(themeName) ?? [];
    if (pool.length === 0) {
      throw new Error(`oral exam: no questions available for theme "${themeName}"`);
    }
    return pool;
  };

  /** Pick one unused question of a theme (avoiding `avoidIds` when possible). */
  const pickForTheme = (themeName: string): PoolQuestion => {
    const pool = poolFor(themeName);
    const fresh = pool.filter((q) => !used.has(q.id));
    if (fresh.length === 0) {
      throw new Error(
        `oral exam: theme "${themeName}" has no more unused questions ` +
          `(pool ${pool.length}, already used in this exam)`,
      );
    }
    let candidates = fresh;
    if (avoidIds && avoidIds.size > 0) {
      const filtered = fresh.filter((q) => !avoidIds.has(q.id));
      if (filtered.length > 0) candidates = filtered;
    }
    return candidates[pickIndex(rng, candidates.length)];
  };

  const slots: ExamSlot[] = [];
  const pushSlot = (theme: OralThemeDef, q: PoolQuestion) => {
    slots.push({
      orderKey: slots.length + 1, // 1..13
      themeName: theme.name,
      weight: theme.weight, // theme weight; the scorer divides by the count
      questionId: q.id,
      excelId: q.excelId,
    });
  };

  // 1) Fixed part: questionsPerExam per theme, in theme order.
  for (const theme of ORAL_THEMES) {
    for (let i = 0; i < theme.questionsPerExam; i++) {
      const q = pickForTheme(theme.name);
      used.add(q.id);
      pushSlot(theme, q);
    }
  }

  // 2) Rotating 13th question from the designated theme.
  const rotationDef = ORAL_THEMES.find((t) => t.name === rotationTheme);
  if (!rotationDef) {
    throw new Error(`oral exam: rotation theme "${rotationTheme}" is not a known theme`);
  }
  const extra = pickForTheme(rotationDef.name);
  used.add(extra.id);
  pushSlot(rotationDef, extra);

  // 3) Structural self-check — never emit a wrongly-shaped exam.
  if (slots.length !== ORAL_QUESTIONS_PER_EXAM) {
    throw new Error(
      `oral exam: expected ${ORAL_QUESTIONS_PER_EXAM} questions, got ${slots.length}`,
    );
  }
  if (used.size !== slots.length) {
    throw new Error("oral exam: duplicate question within one exam");
  }
  for (const theme of ORAL_THEMES) {
    const count = slots.filter((s) => s.themeName === theme.name).length;
    if (count < theme.questionsPerExam) {
      throw new Error(
        `oral exam: theme "${theme.name}" needs ${theme.questionsPerExam} questions, got ${count}`,
      );
    }
    if (count > ORAL_MAX_PER_THEME) {
      throw new Error(`oral exam: theme "${theme.name}" exceeds ${ORAL_MAX_PER_THEME} questions`);
    }
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

export { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM, ORAL_MAX_PER_THEME };
export type { OralThemeDef };
