"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyResolvedTheme,
  loadThemeMode,
  resolveTheme,
  saveThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

interface UseTheme {
  /** The user's stored preference (light/dark/system). */
  mode: ThemeMode;
  /** The concrete theme currently applied to the document. */
  resolved: ResolvedTheme;
  /** Set an explicit preference (persisted + applied). */
  setMode: (mode: ThemeMode) => void;
  /** Convenience: flip between light and dark based on the resolved theme. */
  toggle: () => void;
}

/**
 * Mirrors the compare-state pattern: initial state is the SSR-safe default,
 * the actual value is restored on mount (client only), and writes only happen
 * once mounted — so a fresh mount never wipes a stored preference.
 */
export function useTheme(): UseTheme {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  // Restore the stored preference on mount. The document attribute is already
  // correct (set by the blocking script), but we sync React state to it.
  useEffect(() => {
    const stored = loadThemeMode();
    setModeState(stored);
    applyResolvedTheme(resolveTheme(stored));
    setMounted(true);
  }, []);

  // Keep the document in sync when the stored preference changes, and follow
  // the OS setting while in "system" mode.
  useEffect(() => {
    if (!mounted) return;
    applyResolvedTheme(resolveTheme(mode));
  }, [mode, mounted]);

  // Live-update when following the OS theme.
  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyResolvedTheme(resolveTheme("system"));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(next);
  }, []);

  const toggle = useCallback(() => {
    // Flip based on the currently resolved theme: dark → light, else dark.
    setModeState((prev) => {
      const next: ThemeMode =
        resolveTheme(prev) === "dark" ? "light" : "dark";
      saveThemeMode(next);
      return next;
    });
  }, []);

  return {
    mode,
    resolved: resolveTheme(mode),
    setMode,
    toggle,
  };
}
