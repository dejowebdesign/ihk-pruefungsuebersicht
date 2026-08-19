// Shared persistence for the IHK compare selection.
//
// The overview page and the /vergleich page must agree on where the selected
// IHK ids live. Both use localStorage so that:
//   - navigating from the overview to /vergleich carries the selection,
//   - a browser refresh on /vergleich keeps the selection,
//   - returning to the overview keeps the selection (in-memory + storage),
//   - direct visits to /vergleich with no selection show the empty state.
//
// localStorage is only available in the browser, so every access is guarded
// and wrapped in try/catch (private mode / quota errors must never crash).

export const COMPARE_STORAGE_KEY = "ihk-compare-ids";
export const MAX_COMPARE = 4;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Read the persisted compare selection (max 4, de-duplicated, order kept). */
export function loadCompareIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const id of parsed) {
      if (isNonEmptyString(id) && !ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, MAX_COMPARE);
  } catch {
    return [];
  }
}

/** Persist the current selection (clamped to MAX_COMPARE). Empty → removed. */
export function saveCompareIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const next = ids.slice(0, MAX_COMPARE);
    if (next.length === 0) {
      window.localStorage.removeItem(COMPARE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* ignore quota / private mode errors */
  }
}

/** Remove the persisted selection entirely. */
export function clearCompareIds(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COMPARE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pure helper: toggle an id within a selection, enforcing MAX_COMPARE.
 * Returns the new array (does not mutate input). Removing is always allowed;
 * adding beyond the limit is ignored.
 */
export function toggleCompareId(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= MAX_COMPARE) return ids;
  return [...ids, id];
}
