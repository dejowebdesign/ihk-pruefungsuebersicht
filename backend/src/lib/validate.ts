import type { SheetJson } from "./types";
import { CRITICAL_SHEETS, classifySheet } from "./classify";

/** Expected sheet count for a valid snapshot. */
export const EXPECTED_TOTAL_SHEETS = 85;
export const MIN_TOTAL_SHEETS = 80; // tolerate small drift, fail on big drop
export const EXPECTED_IHK_SHEETS = 81;

/**
 * Validate a snapshot before any data is committed.
 * A failed validation MUST abort the import — never overwrite good data.
 */
export function validateSnapshot(sheets: SheetJson[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byName = new Map(sheets.map((s) => [s.sheetName, s]));

  const sheetCount = sheets.length;
  if (sheetCount < MIN_TOTAL_SHEETS) {
    errors.push(
      `Sheet count ${sheetCount} below minimum ${MIN_TOTAL_SHEETS} — refusing import.`,
    );
  } else if (sheetCount !== EXPECTED_TOTAL_SHEETS) {
    warnings.push(
      `Sheet count ${sheetCount} differs from expected ${EXPECTED_TOTAL_SHEETS}.`,
    );
  }

  // Critical registers must be present and non-empty.
  let hasOverview = false,
    hasMasterQuestions = false,
    hasMasterCases = false,
    hasFrequentErrors = false;
  for (const name of CRITICAL_SHEETS) {
    const s = byName.get(name);
    if (!s) {
      errors.push(`Critical sheet missing: ${name}`);
      continue;
    }
    if (!s.rows || s.rows.length === 0) {
      errors.push(`Critical sheet empty: ${name}`);
      continue;
    }
    switch (name) {
      case "Übersicht":
        hasOverview = true;
        break;
      case "Master_Fragen_Muendlich":
        hasMasterQuestions = true;
        break;
      case "Master_TOP_Fallbeispiele":
        hasMasterCases = true;
        break;
      case "Häufige_Fehler":
        hasFrequentErrors = true;
        break;
    }
  }

  // Übersicht must have a plausible number of IHK rows.
  const overview = byName.get("Übersicht");
  if (overview) {
    const withKurzform = overview.rows.filter((r) => r[2]).length;
    if (withKurzform < 70) {
      errors.push(
        `Übersicht has only ${withKurzform} IHK rows — implausible, refusing import.`,
      );
    } else if (withKurzform !== EXPECTED_IHK_SHEETS) {
      warnings.push(
        `Übersicht IHK count ${withKurzform} differs from expected ${EXPECTED_IHK_SHEETS}.`,
      );
    }
  }

  // Count IHK (city) sheets.
  let ihkSheetCount = 0;
  for (const s of sheets) {
    if (classifySheet(s.sheetName) === "IHK") ihkSheetCount++;
  }
  if (ihkSheetCount < 70) {
    warnings.push(`Only ${ihkSheetCount} IHK city sheets (expected ~${EXPECTED_IHK_SHEETS}).`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sheetCount,
    ihkSheetCount,
    hasOverview,
    hasMasterQuestions,
    hasMasterCases,
    hasFrequentErrors,
  };
}

export type ValidationResult = ReturnType<typeof validateSnapshot>;
