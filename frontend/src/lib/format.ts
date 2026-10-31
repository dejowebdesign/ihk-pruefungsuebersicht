// Shared percentage formatting for the web UI.
//
// Mirrors backend/src/oral/format.ts exactly. Both sides must render the same
// number for the same value: the customer saw "77 %" in the PDF header next to
// "77.25 %" in the detail view, and that mismatch is what this prevents.
//
//   - German decimal comma ("77,25").
//   - Exactly TWO decimals for the OVERALL result.
//   - Trailing zeros dropped for per-theme values ("18", not "18,00").

/**
 * Format a percentage for display.
 *
 * @param value     the number (0..100)
 * @param decimals  how many decimals to keep (default 2)
 * @param trimZeros drop trailing zeros (default true)
 */
export function formatPercent(
  value: number,
  { decimals = 2, trimZeros = true }: { decimals?: number; trimZeros?: boolean } = {},
): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  let out = safe.toFixed(decimals);
  if (trimZeros) out = out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return out.replace(".", ",");
}

/**
 * Format the OVERALL exam result: always two decimals, German comma.
 * This is the single value shown in the UI result and in the PDF.
 */
export function formatOverallPercent(value: number): string {
  return formatPercent(value, { decimals: 2, trimZeros: false });
}
