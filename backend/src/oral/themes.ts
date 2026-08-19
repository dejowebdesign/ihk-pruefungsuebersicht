// The 8 oral-exam Themenbereiche with their Excel weights, in fixed order.
//
// Source: Pruefung sheet rows R8:R15 (Themenbereich | Gewichtung) and the
// "Automatische Fragen" structure (1 question per theme, 8 per exam). The
// order defined here is the order questions appear in an exam and is the
// question-per-theme distribution preserved during randomization.
//
// Weights sum to 100 (= Maximalpunkte). Every weight is even, which is what
// makes `weight/2` for "teilweise richtig" an exact integer in the scoring
// math — see scoring.ts. DO NOT change these values.

export interface OralThemeDef {
  orderKey: number; // 1..8
  name: string; // exact Excel label
  weight: number; // Excel "Gewichtung"
}

export const ORAL_THEMES: readonly OralThemeDef[] = [
  { orderKey: 1, name: "Recht der oeffentlichen Sicherheit und Ordnung", weight: 10 },
  { orderKey: 2, name: "Gewerberecht / Bewachungsverordnung", weight: 12 },
  { orderKey: 3, name: "Buergerliches Gesetzbuch / Jedermannsrechte", weight: 14 },
  { orderKey: 4, name: "Straf- und Verfahrensrecht", weight: 14 },
  { orderKey: 5, name: "Umgang mit Waffen", weight: 8 },
  { orderKey: 6, name: "Umgang mit Menschen / Deeskalation", weight: 18 },
  { orderKey: 7, name: "Datenschutzrecht", weight: 8 },
  { orderKey: 8, name: "Grundlagen der Sicherheitstechnik", weight: 16 },
];

export const ORAL_QUESTIONS_PER_EXAM = ORAL_THEMES.length; // 8

export function themeByOrder(orderKey: number): OralThemeDef {
  const t = ORAL_THEMES.find((x) => x.orderKey === orderKey);
  if (!t) throw new Error(`unknown oral theme orderKey: ${orderKey}`);
  return t;
}
