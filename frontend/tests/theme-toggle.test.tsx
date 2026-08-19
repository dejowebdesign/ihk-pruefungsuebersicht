import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  loadThemeMode,
} from "@/lib/theme";
import { COMPARE_STORAGE_KEY, loadCompareIds } from "@/lib/compare";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("renders an accessible toggle button with an aria-label", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /Design wechseln/ });
    expect(btn).toHaveAttribute("aria-pressed");
  });

  it("reflects the applied theme in aria-pressed after mount (dark)", async () => {
    // Simulate the blocking init script having applied dark mode.
    applyResolvedTheme("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    const btn = await screen.findByRole("button", {
      name: "Zum hellen Design wechseln",
    });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("reflects light mode after mount (aria-pressed=false)", async () => {
    applyResolvedTheme("light");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);
    const btn = await screen.findByRole("button", {
      name: "Zum dunklen Design wechseln",
    });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles dark → light and persists", async () => {
    const user = userEvent.setup();
    applyResolvedTheme("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    const btn = await screen.findByRole("button", {
      name: "Zum hellen Design wechseln",
    });
    await user.click(btn);
    expect(loadThemeMode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("toggles light → dark and persists", async () => {
    const user = userEvent.setup();
    applyResolvedTheme("light");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);
    const btn = await screen.findByRole("button", {
      name: "Zum dunklen Design wechseln",
    });
    await user.click(btn);
    expect(loadThemeMode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("mounting with an existing stored preference does not wipe it (no race)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    // Storage must still hold dark after mount, not be reset to a default.
    expect(loadThemeMode()).toBe("dark");
  });

  it("does not touch the compare selection on mount or toggle", async () => {
    const user = userEvent.setup();
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["ihk-a", "ihk-b"]));
    applyResolvedTheme("light");
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    const { rerender } = render(<ThemeToggle />);
    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);

    const btn = await screen.findByRole("button", {
      name: "Zum dunklen Design wechseln",
    });
    await user.click(btn);

    // Compare selection is unaffected by the theme toggle.
    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);
    expect(loadThemeMode()).toBe("dark");

    // Re-mount (simulating navigation) keeps both intact.
    rerender(<ThemeToggle />);
    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);
    expect(loadThemeMode()).toBe("dark");
  });

  it("manual selection overrides a system preference", async () => {
    const user = userEvent.setup();
    // Pretend the OS prefers dark, no explicit choice yet.
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList);
    localStorage.removeItem(THEME_STORAGE_KEY);
    render(<ThemeToggle />);

    // Explicitly switch to light despite the OS being dark. Resolved theme is
    // currently dark, so the toggle offers to switch to the light theme.
    const btn = await screen.findByRole("button", {
      name: "Zum hellen Design wechseln",
    });
    await act(async () => {
      await user.click(btn);
    });

    expect(loadThemeMode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
