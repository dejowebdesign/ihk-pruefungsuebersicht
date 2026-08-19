// Theme handling for the IHK Prüfungsübersicht.
//
// Two visible modes (light, dark) plus an optional "system" default that
// follows prefers-color-scheme. The applied mode is stored on
// document.documentElement[data-theme] and read from there by CSS tokens in
// globals.css. The user's choice is persisted in localStorage under
// "ihk-theme" — a separate key from the compare selection ("ihk-compare-ids")
// so the two features never interfere.
//
// Flash avoidance: layout.tsx renders a tiny blocking inline script
// (THEME_INIT_SCRIPT) into <head> that runs before first paint, reads the
// stored preference (or falls back to the OS setting) and sets data-theme on
// <html>. React therefore hydrates against an already-correct attribute and
// there is no white flash in dark mode.
//
// This module is server-safe (no React, no "use client"); the reactive hook
// lives in src/lib/use-theme.ts so layout.tsx (a Server Component) can import
// the script string without crossing a client boundary.

export const THEME_STORAGE_KEY = "ihk-theme";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** The attribute written onto <html> by the init script and the toggle. */
const DATA_ATTR = "data-theme";

function isMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

/** Read the stored user preference (defaults to "system"). */
export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Persist a user's explicit choice. */
export function saveThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode errors */
  }
}

/** Resolve "system" to a concrete light/dark via matchMedia. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Apply a resolved theme to <html>. No-op on the server. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(DATA_ATTR, resolved);
}

/**
 * The blocking inline script. Runs before paint to set data-theme from storage
 * (or the OS setting), preventing a white flash in dark mode. Inlined as
 * dangerouslySetInnerHTML in layout.tsx. Kept here (server-safe, no React) so
 * the Server Component layout can import it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var v=localStorage.getItem(k);var m=v==="light"||v==="dark"||v==="system"?v:"system";var d=m==="dark"||(m==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;
