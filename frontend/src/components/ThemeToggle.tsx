"use client";

import { useTheme } from "@/lib/use-theme";

/**
 * Light/dark toggle for the site header.
 *
 * Renders a neutral, server-stable button until mounted (so the icon never
 * mismatches between SSR and client), then shows the sun/moon for the
 * currently applied theme. The actual theme is applied before first paint by
 * the blocking init script in layout.tsx, so there is no white flash.
 */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln"}
      aria-pressed={isDark}
      title={isDark ? "Helles Design aktivieren" : "Dunkles Design aktivieren"}
    >
      {/* Sun (shown in dark mode → switch to light) */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--sun"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      {/* Moon (shown in light mode → switch to dark) */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--moon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
