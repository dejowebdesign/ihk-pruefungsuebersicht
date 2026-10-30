// Oral exam grading — weighted PERCENTAGE model (Phase 11).
//
// The former points system (Excel G8:G20 mirror) was replaced by the weighted
// percentage model requested by the customer. The old points scorer is kept
// below ONLY to keep pre-Phase-11 historical exams (scoringVersion 1) readable
// and recomputable without altering their stored results.
//
// Percentage model (3 steps, no premature rounding):
//   Step 1  theme result = (sum of achieved rating factors)
//                        / (number of asked questions of that theme)   -> 0..1
//   Step 2  contribution = theme result * theme weight                (pp)
//   Step 3  total        = sum of the 8 contributions                 (0..100)
//
// Rating factors (3-stage Bewertung, see B1):
//   richtig           -> 1.0  (100 % of the question's value)
//   teilweise richtig -> 0.5  ( 50 %)
//   falsch / unrated  -> 0    (  0 %; unanswered counts as wrong)
//
// The theme weight is INDEPENDENT of how many questions were asked, so a theme
// asked twice is still scored over the same weight as when asked once.
//
// All values stay exact in IEEE-754: question counts per theme are 1 or 2 and
// every weight is an integer, so results are multiples of 0.25 (e.g. 13.5, 6.75)
// — all exactly representable. We never round mid-calculation; only display
// code may round.

export type Rating = "richtig" | "teilweise richtig" | "falsch";

export const RATINGS: readonly Rating[] = [
  "richtig",
  "teilweise richtig",
  "falsch",
] as const;

export function isRating(v: unknown): v is Rating {
  return v === "richtig" || v === "teilweise richtig" || v === "falsch";
}

/** Achieved fraction of a single question's value (0, 0.5 or 1). */
export function questionFactor(rating: Rating | null | undefined): number {
  if (rating === "richtig") return 1;
  if (rating === "teilweise richtig") return 0.5;
  return 0; // "falsch" or not yet rated
}

/** Pass mark: 50 % — the old 50-of-100-points threshold transferred 1:1. */
export const ORAL_PASS_PERCENT = 50;

export interface ThemeScore {
  themeName: string;
  /** Theme weight in percent (fixed, independent of the question count). */
  weight: number;
  /** How many questions of this theme were asked (1 or 2). */
  asked: number;
  /** Sum of achieved rating factors. */
  achieved: number;
  /** Theme result in percent (0..100) = achieved / asked * 100. */
  percent: number;
  /** Weighted contribution in percentage points = achieved / asked * weight. */
  contribution: number;
}

export interface ScoredExam {
  /** Total result in percent (0..100). */
  percent: number;
  result: "Bestanden" | "Nicht bestanden";
  /** Per-theme breakdown, in the order themes first appear. */
  themes: ThemeScore[];
}

export interface ScoreItem {
  themeName: string;
  weight: number;
  rating: Rating | null;
}

/** Weighted percentage score of an exam from its (snapshotted) items. */
export function scoreExam(items: ReadonlyArray<ScoreItem>): ScoredExam {
  const byTheme = new Map<string, { weight: number; asked: number; achieved: number }>();
  for (const it of items) {
    const cur = byTheme.get(it.themeName) ?? { weight: it.weight, asked: 0, achieved: 0 };
    cur.asked += 1;
    cur.achieved += questionFactor(it.rating);
    byTheme.set(it.themeName, cur);
  }

  const themes: ThemeScore[] = [];
  let total = 0;
  for (const [themeName, t] of byTheme) {
    const result = t.asked > 0 ? t.achieved / t.asked : 0; // 0..1
    const contribution = result * t.weight;
    total += contribution;
    themes.push({
      themeName,
      weight: t.weight,
      asked: t.asked,
      achieved: t.achieved,
      percent: result * 100,
      contribution,
    });
  }

  return { percent: total, result: passResult(total), themes };
}

/** Bestehensstatus: >= 50 % (the former 50-of-100-points rule). */
export function passResult(
  percent: number,
  threshold: number = ORAL_PASS_PERCENT,
): "Bestanden" | "Nicht bestanden" {
  return percent >= threshold ? "Bestanden" : "Nicht bestanden";
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy points scorer (scoringVersion 1) — pre-Phase-11 exams only.
//
// Kept so a historical exam can still be recomputed with the rules it was
// graded under. New exams never use these functions.
// ─────────────────────────────────────────────────────────────────────────

export const ORAL_MAX_POINTS = 100;
export const ORAL_PASS_THRESHOLD = 50; // legacy: G18 >= 50

/** Legacy per-question points (Excel Pruefung!G formula). */
export function questionPoints(weight: number, rating: Rating | null | undefined): number {
  if (rating === "richtig") return weight;
  if (rating === "teilweise richtig") return weight / 2;
  return 0;
}

/** Legacy total points (Excel G18 = SUM(G8:G15)). */
export function totalPoints(
  items: ReadonlyArray<{ weight: number; rating: Rating | null }>,
): number {
  return items.reduce((sum, it) => sum + questionPoints(it.weight, it.rating), 0);
}

/** Legacy percent (Excel G19 = G18/G17), expressed as 0..100. */
export function percentValue(total: number, max: number = ORAL_MAX_POINTS): number {
  if (max <= 0) return 0;
  return (total * 100) / max;
}

export interface LegacyScoredExam {
  maxPoints: number;
  totalPoints: number;
  percent: number;
  result: "Bestanden" | "Nicht bestanden";
}

/** Legacy full scoring (scoringVersion 1 exams). */
export function scoreExamLegacy(
  items: ReadonlyArray<{ weight: number; rating: Rating | null }>,
  max: number = ORAL_MAX_POINTS,
): LegacyScoredExam {
  const total = totalPoints(items);
  return {
    maxPoints: max,
    totalPoints: total,
    percent: percentValue(total, max),
    result: total >= ORAL_PASS_THRESHOLD ? "Bestanden" : "Nicht bestanden",
  };
}
