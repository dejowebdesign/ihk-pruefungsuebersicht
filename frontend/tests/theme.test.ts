import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  loadThemeMode,
  resolveTheme,
  saveThemeMode,
} from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme storage", () => {
  it("defaults to 'system' when nothing is stored", () => {
    expect(loadThemeMode()).toBe("system");
  });

  it("round-trips an explicit mode through storage", () => {
    saveThemeMode("dark");
    expect(loadThemeMode()).toBe("dark");
    saveThemeMode("light");
    expect(loadThemeMode()).toBe("light");
    saveThemeMode("system");
    expect(loadThemeMode()).toBe("system");
  });

  it("treats a corrupt/unknown value as 'system'", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "rainbow");
    expect(loadThemeMode()).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("resolves explicit modes directly", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves 'system' via prefers-color-scheme", () => {
    const mql = { matches: true } as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(mql);
    expect(resolveTheme("system")).toBe("dark");

    const mql2 = { matches: false } as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(mql2);
    expect(resolveTheme("system")).toBe("light");
  });

  it("falls back to 'light' when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    // @ts-expect-error simulate absence
    delete window.matchMedia;
    expect(resolveTheme("system")).toBe("light");
    window.matchMedia = original;
  });
});

describe("applyResolvedTheme", () => {
  it("writes the data-theme attribute on <html>", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("theme storage isolation", () => {
  // A foreign key stands in for any other feature that writes to localStorage:
  // saving a theme must not disturb unrelated entries, and vice versa.
  const OTHER_KEY = "ihk-other-feature";

  it("uses its own localStorage key", () => {
    expect(THEME_STORAGE_KEY).toBe("ihk-theme");
  });

  it("saving a theme never touches another feature's entry", () => {
    localStorage.setItem(OTHER_KEY, JSON.stringify(["a", "b"]));
    saveThemeMode("dark");
    expect(JSON.parse(localStorage.getItem(OTHER_KEY) as string)).toEqual(["a", "b"]);
  });

  it("another feature writing storage never touches the theme", () => {
    saveThemeMode("dark");
    localStorage.setItem(OTHER_KEY, JSON.stringify(["x"]));
    expect(loadThemeMode()).toBe("dark");
  });

  it("clearing theme storage leaves other entries untouched", () => {
    saveThemeMode("dark");
    localStorage.setItem(OTHER_KEY, JSON.stringify(["a"]));
    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(loadThemeMode()).toBe("system");
    expect(JSON.parse(localStorage.getItem(OTHER_KEY) as string)).toEqual(["a"]);
  });
});
