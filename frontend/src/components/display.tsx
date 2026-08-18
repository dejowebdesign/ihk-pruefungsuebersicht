// Display helpers: render null/unknown/empty consistently ("Keine Angabe").
import type { ReactNode } from "react";

const MISSING = "Keine Angabe";

export function display(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING;
  return value;
}

export function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

export function DisplayValue({ value }: { value: string | null | undefined }) {
  if (isMissing(value)) return <span style={{ color: "var(--text-faint)" }}>{MISSING}</span>;
  return <>{value}</>;
}

export function DisplayCell({ value }: { value: string | null | undefined }): ReactNode {
  if (isMissing(value)) return <span style={{ color: "var(--text-faint)" }}>–</span>;
  return <>{value}</>;
}
