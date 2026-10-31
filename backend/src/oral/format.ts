// Shared percentage formatting for the oral exam.
//
// ONE definition is used by the PDF, the API payload and (mirrored in
// frontend/src/lib/format.ts) the web UI, so the overall result can never be
// rendered as two different numbers. The customer saw "77 %" in the PDF header
// and "77.25 %" in the detail view — that class of mismatch must not return.
//
// Rules:
//   - German decimal comma ("77,25").
//   - Exactly TWO decimals for the overall result (customer requirement).
//   - Trailing ",00" is dropped for per-theme values so a clean 18 reads as
//     "18" and not "18,00" — the overall result keeps both decimals.
//   - No thousands separator; values never exceed 100.

/**
 * Format a percentage for display.
 *
 * @param value     the number (0..100)
 * @param decimals  how many decimals to keep (default 2)
 * @param trimZeros drop trailing ",00"/",50" zeros (default true)
 */
export function formatPercent(
  value: number,
  { decimals = 2, trimZeros = true }: { decimals?: number; trimZeros?: boolean } = {},
): string {
  if (!Number.isFinite(value)) return "-";
  // Round to the requested precision, then strip the "-0" edge case.
  const rounded = Number(value.toFixed(decimals));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  let out = safe.toFixed(decimals);
  if (trimZeros) out = out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return out.replace(".", ",");
}

/**
 * Format the OVERALL exam result: always two decimals, German comma.
 * This is the single value shown in the PDF header, the PDF total row and the
 * UI result — it must be byte-identical in all three.
 */
export function formatOverallPercent(value: number): string {
  return formatPercent(value, { decimals: 2, trimZeros: false });
}

/** Convenience: "77,25 %". */
export function percentLabel(value: number, opts?: { decimals?: number; trimZeros?: boolean }): string {
  return `${formatPercent(value, opts)} %`;
}
