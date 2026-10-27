// The 9 oral-exam Themenbereiche with their weights, in fixed order.
//
// The first 8 Themenbereiche and their order come from the Excel workbook
// ("Pruefung" sheet rows R8:R15). The 9th, "Unfallverhuetungsvorschriften"
// (UVV/DGUV), was added later as an independent Themenbereich.
//
// Exam structure (13 questions):
//   - exactly 1 question from EACH of the 9 Themenbereiche  -> 9 questions,
//   - 4 additional questions distributed over 4 DISTINCT of the remaining
//     8 Themenbereiche (UVV never gets a 2nd)               -> 4 questions,
//   - no Themenbereich has more than 2 questions,
//   - theme order (orderKey 1..9) is preserved; the 4 extra slots get the
//     ascending orderKeys 10..13.
//
// Weights sum to 100 (= Maximalpunkte). Every weight is divisible by 4, which
// is what makes both `weight/2` (two questions in a theme) and `weight/4`
// ("teilweise richtig" on a doubled theme) exact integers - see scoring.ts.
// DO NOT change these values without an explicit, documented decision.

export interface OralThemeDef {
  orderKey: number; // 1..9
  name: string; // exact label
  weight: number; // Gewichtung (sum = 100)
}

export const ORAL_THEMES: readonly OralThemeDef[] = [
  { orderKey: 1, name: "Recht der oeffentlichen Sicherheit und Ordnung", weight: 8 },
  { orderKey: 2, name: "Gewerberecht / Bewachungsverordnung", weight: 12 },
  { orderKey: 3, name: "Buergerliches Gesetzbuch / Jedermannsrechte", weight: 12 },
  { orderKey: 4, name: "Straf- und Verfahrensrecht", weight: 12 },
  { orderKey: 5, name: "Umgang mit Waffen", weight: 8 },
  { orderKey: 6, name: "Umgang mit Menschen / Deeskalation", weight: 16 },
  { orderKey: 7, name: "Datenschutzrecht", weight: 8 },
  { orderKey: 8, name: "Grundlagen der Sicherheitstechnik", weight: 16 },
  { orderKey: 9, name: "Unfallverhuetungsvorschriften", weight: 8 },
];

/** The UVV/DGUV Themenbereich - never receives an additional (2nd) question. */
export const ORAL_UVV_THEME = "Unfallverhuetungsvorschriften";

/** Exactly one base question per Themenbereich (9). */
export const ORAL_BASE_QUESTIONS = ORAL_THEMES.length; // 9

/** Additional questions distributed over distinct themes (themes 1..8 only). */
export const ORAL_EXTRA_QUESTIONS = 4;

/** Total questions per exam. */
export const ORAL_QUESTIONS_PER_EXAM = ORAL_BASE_QUESTIONS + ORAL_EXTRA_QUESTIONS; // 13

/** Max questions a single Themenbereich may contribute (base + one extra). */
export const ORAL_MAX_PER_THEME = 2;

/** Sum of all theme weights (= Maximalpunkte). Must be 100. */
export const ORAL_TOTAL_WEIGHT = ORAL_THEMES.reduce((s, t) => s + t.weight, 0);

export function themeByOrder(orderKey: number): OralThemeDef {
  const t = ORAL_THEMES.find((x) => x.orderKey === orderKey);
  if (!t) throw new Error(`unknown oral theme orderKey: ${orderKey}`);
  return t;
}

export function themeByName(name: string): OralThemeDef {
  const t = ORAL_THEMES.find((x) => x.name === name);
  if (!t) throw new Error(`unknown oral theme name: ${name}`);
  return t;
}
