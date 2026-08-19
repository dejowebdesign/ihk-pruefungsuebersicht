// Oral exam grading — VERBATIM mirror of the Excel matrix logic.
//
// Reference: Pruefungsmatrix_muendliche_Pruefung_34a_vereinfacht_mit_Antworten.xlsx
//   Pruefung!G8:G15 per-question points:
//     =IF(F="","",IF(F="richtig",B,IF(F="teilweise richtig",B/2,0)))
//   Pruefung!G17 Maximalpunkte = 100
//   Pruefung!G18 Summe = SUM(G8:G15)
//   Pruefung!G19 Prozentwert = G18/G17
//   Pruefung!G20 Bestehensstatus = IF(G18>=50,"Bestanden","Nicht bestanden")
//
// Number formats are display-only in Excel; all weights are even so every
// per-question score is an exact integer and percent = points/100 is exact.
// We therefore keep full precision everywhere and never round mid-calculation.
//
// DO NOT modify this math. Any change here breaks the 1:1 Excel parity tests.

export const ORAL_MAX_POINTS = 100;
export const ORAL_PASS_THRESHOLD = 50; // Excel G20: G18>=50

export type Rating = "richtig" | "teilweise richtig" | "falsch";

export const RATINGS: readonly Rating[] = [
  "richtig",
  "teilweise richtig",
  "falsch",
] as const;

export function isRating(v: unknown): v is Rating {
  return v === "richtig" || v === "teilweise richtig" || v === "falsch";
}

/**
 * Per-question points (Excel Pruefung!G formula).
 *   richtig           → full weight (B)
 *   teilweise richtig → weight / 2 (B/2)
 *   falsch / null     → 0
 * Unrated (null) contributes 0 points, matching Excel's "" branch.
 */
export function questionPoints(weight: number, rating: Rating | null | undefined): number {
  if (rating === "richtig") return weight;
  if (rating === "teilweise richtig") return weight / 2;
  return 0; // "falsch" or not yet rated
}

/**
 * Total points = sum of per-question points (Excel G18 = SUM(G8:G15)).
 * Inputs are {weight, rating} per exam question. Full precision, no rounding.
 */
export function totalPoints(
  items: ReadonlyArray<{ weight: number; rating: Rating | null }>,
): number {
  return items.reduce((sum, it) => sum + questionPoints(it.weight, it.rating), 0);
}

/**
 * Percent value (Excel G19 = G18/G17), expressed as 0..100.
 * Excel stores the fraction (0.55) and the '0.0%' format displays fraction×100
 * (→ "55.0 %"). We return the numeric percent. We compute `total*100/max`
 * (not `(total/max)*100`) to avoid IEEE-754 artefacts like 55.00000000000001:
 * with integer totals and max=100 the result is an exact integer, matching
 * Excel's displayed percent exactly. Full precision, no mid-calc rounding.
 */
export function percentValue(total: number, max: number = ORAL_MAX_POINTS): number {
  if (max <= 0) return 0;
  return (total * 100) / max;
}

/**
 * Bestehensstatus (Excel G20 = IF(G18>=50,"Bestanden","Nicht bestanden")).
 */
export function passResult(
  total: number,
  threshold: number = ORAL_PASS_THRESHOLD,
): "Bestanden" | "Nicht bestanden" {
  return total >= threshold ? "Bestanden" : "Nicht bestanden";
}

export interface ScoredExam {
  maxPoints: number;
  totalPoints: number;
  percent: number; // 0..100, Excel G19 × 100
  result: "Bestanden" | "Nicht bestanden";
}

/** Full scoring of an exam from its question items. */
export function scoreExam(
  items: ReadonlyArray<{ weight: number; rating: Rating | null }>,
  max: number = ORAL_MAX_POINTS,
): ScoredExam {
  const total = totalPoints(items);
  return {
    maxPoints: max,
    totalPoints: total,
    percent: percentValue(total, max),
    result: passResult(total),
  };
}
