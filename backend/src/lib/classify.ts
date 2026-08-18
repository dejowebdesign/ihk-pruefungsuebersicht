import type { SheetType } from "./types";

const SPECIAL: Record<string, SheetType> = {
  Übersicht: "OVERVIEW",
  Master_Fragen_Muendlich: "MASTER_QUESTIONS",
  Master_TOP_Fallbeispiele: "MASTER_CASES",
  Häufige_Fehler: "FREQUENT_ERRORS",
};

/** Classify a sheet by its original register name. */
export function classifySheet(name: string): SheetType {
  if (name in SPECIAL) return SPECIAL[name];
  // City IHK registers: everything else in the manifest (Aachen..VSW_Mainz).
  return "IHK";
}

/** The 4 critical (master/special) register names. */
export const CRITICAL_SHEETS = Object.keys(SPECIAL);
