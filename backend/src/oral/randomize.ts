// Random question selection for a new oral exam.
//
// Structure (13 questions, see themes.ts):
//   - exactly 1 question from EACH of the 9 Themenbereiche (base),
//   - 4 additional questions over 4 DISTINCT of the remaining 8 themes
//     (UVV/DGUV never gets a 2nd question),
//   - no theme contributes more than 2 questions,
//   - no duplicate question ids within an exam,
//   - theme order preserved for the 9 base slots (orderKey 1..9); the 4 extra
//     slots take the ascending orderKeys 10..13.
//
// A pluggable RNG (`() => number` in [0,1)) makes selection deterministic in
// tests and truly random in production.

import type { OralThemeDef } from "./themes";
import {
  ORAL_THEMES,
  ORAL_BASE_QUESTIONS,
  ORAL_EXTRA_QUESTIONS,
  ORAL_QUESTIONS_PER_EXAM,
  ORAL_UVV_THEME,
} from "./themes";

export interface PoolQuestion {
  id: string;
  excelId: string;
  themeName: string;
}

export interface ExamSlot {
  orderKey: number;
  themeName: string;
  weight: number; // per-question weight (theme weight / questions of that theme)
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

/** Fisher-Yates pick of one index in [0, n) using the given RNG. */
function pickIndex(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Partial Fisher-Yates: return `k` distinct items (order randomized). */
function pickDistinct<T>(rng: Rng, items: readonly T[], k: number): T[] {
  const arr = items.slice();
  const out: T[] = [];
  for (let i = 0; i < k && arr.length > 0; i++) {
    const j = pickIndex(rng, arr.length);
    out.push(arr[j]);
    arr.splice(j, 1);
  }
  return out;
}

/**
 * Build an exam slot list: one question per theme (9) plus 4 extra questions
 * over 4 distinct non-UVV themes. `pool` must be grouped per theme.
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
  const used = new Set<string>();

  // Pick one question for a theme, avoiding `avoidIds` when possible and never
  // reusing an id already used in this exam.
  const pickForTheme = (themeName: string): PoolQuestion => {
    const pool = perTheme.get(themeName) ?? [];
    if (pool.length === 0) {
      throw new Error(`oral exam: no questions available for theme "${themeName}"`);
    }
    const fresh = pool.filter((q) => !used.has(q.id));
    const base = fresh.length > 0 ? fresh : pool;
    let candidates = base;
    if (avoidIds && avoidIds.size > 0) {
      const filtered = base.filter((q) => !avoidIds.has(q.id));
      candidates = filtered.length > 0 ? filtered : base;
    }
    return candidates[pickIndex(rng, candidates.length)];
  };

  const slots: ExamSlot[] = [];

  // 1) Base: one question per theme, theme order preserved (orderKey 1..9).
  const baseQuestions = new Map<string, PoolQuestion>();
  for (const theme of ORAL_THEMES) {
    const q = pickForTheme(theme.name);
    used.add(q.id);
    baseQuestions.set(theme.name, q);
  }

  // 2) Extras: 4 distinct themes among the non-UVV themes that still have an
  //    unused question. UVV is excluded by policy (exactly one UVV question).
  const eligible = ORAL_THEMES.filter(
    (t) =>
      t.name !== ORAL_UVV_THEME &&
      (perTheme.get(t.name) ?? []).some((q) => !used.has(q.id)),
  );
  if (eligible.length < ORAL_EXTRA_QUESTIONS) {
    throw new Error(
      `oral exam: need ${ORAL_EXTRA_QUESTIONS} eligible themes for extra questions, ` +
        `found ${eligible.length}`,
    );
  }
  const extraThemes = pickDistinct(rng, eligible, ORAL_EXTRA_QUESTIONS);

  // 3) Assemble: base slots first (orderKey = theme orderKey 1..9), then extra
  //    slots (orderKey 10..13). Per-question weight = theme weight / count.
  const countByTheme = new Map<string, number>();
  for (const t of ORAL_THEMES) countByTheme.set(t.name, 1);
  for (const t of extraThemes) countByTheme.set(t.name, 2);

  const pushSlot = (theme: OralThemeDef, q: PoolQuestion) => {
    const count = countByTheme.get(theme.name) ?? 1;
    slots.push({
      orderKey: slots.length + 1, // 1..13
      themeName: theme.name,
      weight: theme.weight / count,
      questionId: q.id,
      excelId: q.excelId,
    });
  };

  for (const theme of ORAL_THEMES) {
    pushSlot(theme, baseQuestions.get(theme.name)!);
  }
  for (const theme of extraThemes) {
    const q = pickForTheme(theme.name);
    used.add(q.id);
    pushSlot(theme, q);
  }

  if (slots.length !== ORAL_QUESTIONS_PER_EXAM) {
    throw new Error(
      `oral exam: expected ${ORAL_QUESTIONS_PER_EXAM} questions, got ${slots.length}`,
    );
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

export {
  ORAL_THEMES,
  ORAL_BASE_QUESTIONS,
  ORAL_EXTRA_QUESTIONS,
  ORAL_QUESTIONS_PER_EXAM,
  ORAL_UVV_THEME,
};
export type { OralThemeDef };
