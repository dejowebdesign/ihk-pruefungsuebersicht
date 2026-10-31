// The 8 oral-exam Themenbereiche with their percentage weights, in fixed order.
//
// Phase 11: the former 9-theme/points model was replaced by the 8-theme/percent
// model requested by the customer.
//   - "Gewerberecht / Bewachungsverordnung" and "Recht der oeffentlichen
//     Sicherheit und Ordnung" were MERGED into one Themenbereich
//     ("Recht der oeffentlichen Sicherheit und Ordnung einschliesslich
//     Gewerberecht"). All 20 Gewerberecht questions were kept and now share a
//     single random-selection pool with the RdOesO questions.
//   - Weights are percentages summing to exactly 100.
//
// Exam structure (exactly 13 questions):
//   - 2 questions from EACH of the 4 main Themenbereiche   -> 8 questions,
//   - 1 question from EACH of the 4 other Themenbereiche   -> 4 questions,
//   - a 13th question from ONE of the 4 other Themenbereiche, chosen by a
//     persisted, evenly rotating counter (see rotation.ts) -> 1 question.
//   - no duplicate question within an exam, at most 2 questions per theme.
//
// Grading is a weighted percentage (see scoring.ts): a theme's own result
// (achieved fraction of its asked questions) is multiplied by the theme weight.
// The weight NEVER depends on how many questions of that theme were asked, so
// a theme is scored over the same 18% whether 1 or 2 questions were drawn.
//
// Naming note: theme labels keep the codebase's transliterated spelling
// (oe/ue/ss) so they stay byte-comparable with the existing seed data.
//
// DO NOT change these values without an explicit, documented decision.

export interface OralThemeDef {
  orderKey: number; // 1..8, fixed order key
  name: string; // exact label
  weight: number; // Gewichtung in percent (sum = 100)
  /** Exactly this many questions are drawn from this theme on every exam. */
  questionsPerExam: number;
}

/** The 4 main Themenbereiche: always exactly two questions each. */
export const ORAL_MAIN_THEME_NAMES = [
  "Buergerliches Gesetzbuch / Jedermannsrechte",
  "Straf- und Verfahrensrecht",
  "Umgang mit Menschen / Deeskalation",
  "Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht",
] as const;

/**
 * The 4 other Themenbereiche: exactly one fixed question each. They are also
 * the pool the rotating 13th question is drawn from, in this order.
 */
export const ORAL_OTHER_THEME_NAMES = [
  "Datenschutzrecht",
  "Unfallverhuetungsvorschriften",
  "Umgang mit Waffen",
  "Grundlagen der Sicherheitstechnik",
] as const;

/** The merged Themenbereich (former RdOesO + Gewerberecht). */
export const ORAL_MERGED_THEME_NAME =
  "Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht";

export const ORAL_THEMES: readonly OralThemeDef[] = [
  {
    orderKey: 1,
    name: "Buergerliches Gesetzbuch / Jedermannsrechte",
    weight: 18,
    questionsPerExam: 2,
  },
  { orderKey: 2, name: "Straf- und Verfahrensrecht", weight: 18, questionsPerExam: 2 },
  { orderKey: 3, name: "Umgang mit Menschen / Deeskalation", weight: 18, questionsPerExam: 2 },
  { orderKey: 4, name: ORAL_MERGED_THEME_NAME, weight: 10, questionsPerExam: 2 },
  { orderKey: 5, name: "Datenschutzrecht", weight: 9, questionsPerExam: 1 },
  { orderKey: 6, name: "Unfallverhuetungsvorschriften", weight: 9, questionsPerExam: 1 },
  { orderKey: 7, name: "Umgang mit Waffen", weight: 9, questionsPerExam: 1 },
  { orderKey: 8, name: "Grundlagen der Sicherheitstechnik", weight: 9, questionsPerExam: 1 },
];

/** Themes that contribute one fixed question and take part in the rotation. */
export const ORAL_ROTATION_THEMES: readonly string[] = ORAL_OTHER_THEME_NAMES;

/** Fixed (non-rotating) questions: 4x2 main + 4x1 other = 12. */
export const ORAL_FIXED_QUESTIONS = ORAL_THEMES.reduce((s, t) => s + t.questionsPerExam, 0);

/** The single rotating 13th question. */
export const ORAL_ROTATING_QUESTIONS = 1;

/** Total questions per exam. */
export const ORAL_QUESTIONS_PER_EXAM = ORAL_FIXED_QUESTIONS + ORAL_ROTATING_QUESTIONS; // 13

/** A theme never contributes more than this many questions. */
export const ORAL_MAX_PER_THEME = 2;

/** Sum of all theme weights. Must be exactly 100. */
export const ORAL_TOTAL_WEIGHT = ORAL_THEMES.reduce((s, t) => s + t.weight, 0);

/**
 * Legacy theme names from the pre-Phase-11 model, mapped to their successor.
 * Historical exams and historical OralQuestion rows may still carry these
 * names; normalising keeps them scoreable without touching stored data.
 */
export const ORAL_LEGACY_THEME_ALIASES: Readonly<Record<string, string>> = {
  "Gewerberecht / Bewachungsverordnung": ORAL_MERGED_THEME_NAME,
  "Recht der oeffentlichen Sicherheit und Ordnung": ORAL_MERGED_THEME_NAME,
};

/** Map a (possibly legacy) theme name to the current 8-theme name. */
export function normalizeThemeName(name: string): string {
  return ORAL_LEGACY_THEME_ALIASES[name] ?? name;
}

/**
 * Short display labels for the 8 themes.
 *
 * The stored names are the authoritative Excel spellings and are never
 * changed, but they are too long for a PDF table cell or a narrow phone
 * screen (the merged theme is 74 characters). These labels are DISPLAY ONLY:
 * reports and the UI still key everything by the full stored name.
 */
const ORAL_THEME_SHORT: Readonly<Record<string, string>> = {
  "Buergerliches Gesetzbuch / Jedermannsrechte": "BGB / Jedermannsrechte",
  "Straf- und Verfahrensrecht": "Straf- und Verfahrensrecht",
  "Umgang mit Menschen / Deeskalation": "Umgang mit Menschen",
  [ORAL_MERGED_THEME_NAME]: "Oeff. Sicherheit / Gewerberecht",
  "Datenschutzrecht": "Datenschutzrecht",
  "Unfallverhuetungsvorschriften": "UVV / DGUV",
  "Umgang mit Waffen": "Umgang mit Waffen",
  "Grundlagen der Sicherheitstechnik": "Sicherheitstechnik",
};

/** Short label for a theme (falls back to the full stored name). */
export function shortThemeName(name: string): string {
  const normalized = normalizeThemeName(name);
  return ORAL_THEME_SHORT[normalized] ?? normalized;
}

/**
 * Compact abbreviation used in a question heading, e.g. "BGB" in
 * "Frage 1 - BGB". Derived from the short label's first segment.
 */
export function themeAbbreviation(name: string): string {
  const normalized = normalizeThemeName(name);
  const abbr: Record<string, string> = {
    "Buergerliches Gesetzbuch / Jedermannsrechte": "BGB",
    "Straf- und Verfahrensrecht": "StGB",
    "Umgang mit Menschen / Deeskalation": "UmM",
    [ORAL_MERGED_THEME_NAME]: "RdOesO/GewO",
    "Datenschutzrecht": "Datenschutz",
    "Unfallverhuetungsvorschriften": "UVV",
    "Umgang mit Waffen": "Waffen",
    "Grundlagen der Sicherheitstechnik": "Sicherheitstechnik",
  };
  return abbr[normalized] ?? shortThemeName(normalized);
}

export function themeByOrder(orderKey: number): OralThemeDef {
  const t = ORAL_THEMES.find((x) => x.orderKey === orderKey);
  if (!t) throw new Error(`unknown oral theme orderKey: ${orderKey}`);
  return t;
}

export function themeByName(name: string): OralThemeDef {
  const wanted = normalizeThemeName(name);
  const t = ORAL_THEMES.find((x) => x.name === wanted);
  if (!t) throw new Error(`unknown oral theme name: ${name}`);
  return t;
}

export function isMainTheme(name: string): boolean {
  return (ORAL_MAIN_THEME_NAMES as readonly string[]).includes(normalizeThemeName(name));
}

export function isRotationTheme(name: string): boolean {
  return (ORAL_ROTATION_THEMES as readonly string[]).includes(normalizeThemeName(name));
}

/** The theme the rotating 13th question is taken from, for a counter value. */
export function rotationThemeFor(counter: number): string {
  const n = ORAL_ROTATION_THEMES.length;
  const idx = ((counter % n) + n) % n;
  return ORAL_ROTATION_THEMES[idx];
}
