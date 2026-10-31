import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useScrolled } from "@/lib/use-scrolled";
import { IDENTITY_CACHE_KEY } from "@/lib/auth";

// The Header uses the App Router hooks; these tests render it outside a real
// Next.js router, so the navigation module is stubbed.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const root = resolve(__dirname, "..");
const css = readFileSync(resolve(root, "src/styles/globals.css"), "utf8");

/**
 * Body of the rule for `selector` whose declarations contain `marker`.
 *
 * A selector can legitimately appear more than once (base rule, `@supports`
 * upgrade, media override), so the marker — a declaration unique to the rule
 * under test — disambiguates instead of relying on position in the file.
 */
function rule(selector: string, marker: string): string {
  const needle = `${selector} {`;
  for (let at = css.indexOf(needle); at > -1; at = css.indexOf(needle, at + 1)) {
    const body = css.slice(at, css.indexOf("}", at));
    if (body.includes(marker)) return body;
  }
  throw new Error(`rule ${selector} containing "${marker}" not found`);
}

/** Body of a rule inside the first `@supports` block that mentions it. */
function supportsRule(selector: string): string {
  const at = css.indexOf("@supports ((backdrop-filter: blur(1px))");
  expect(at, "backdrop-filter @supports block not found").toBeGreaterThan(-1);
  const start = css.indexOf(selector, at);
  expect(start, `${selector} not found in the @supports block`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

/** Set the scroll offset and let the listener's animation frame run. */
async function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useScrolled", () => {
  function Probe() {
    const scrolled = useScrolled(24, 8);
    return <span data-testid="state">{scrolled ? "compact" : "normal"}</span>;
  }

  it("starts in the normal state at the top of the page", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("normal");
  });

  it("switches to compact past the threshold and back at the top", async () => {
    render(<Probe />);
    await scrollTo(200);
    expect(screen.getByTestId("state")).toHaveTextContent("compact");
    await scrollTo(0);
    expect(screen.getByTestId("state")).toHaveTextContent("normal");
  });

  it("does not flip while resting on the threshold (hysteresis)", async () => {
    render(<Probe />);
    await scrollTo(30); // above 24 → compact
    expect(screen.getByTestId("state")).toHaveTextContent("compact");
    // 20 is below the threshold but still inside the hysteresis band, so the
    // state must hold instead of oscillating.
    await scrollTo(20);
    expect(screen.getByTestId("state")).toHaveTextContent("compact");
    await scrollTo(15); // below 24 - 8 → back to normal
    expect(screen.getByTestId("state")).toHaveTextContent("normal");
  });

  it("registers a passive listener and removes it on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Probe />);
    const call = add.mock.calls.find(([type]) => type === "scroll");
    expect(call, "no scroll listener registered").toBeTruthy();
    expect(call?.[2]).toMatchObject({ passive: true });
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "scroll")).toBe(true);
  });

  it("coalesces a scroll burst into a single animation frame", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<Probe />);
    await act(async () => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("scroll"));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    // Five events, but only one frame was scheduled for them.
    expect(raf.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("Header — scroll state wiring", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    } as unknown as Response);
  });

  it("carries the compact modifier only while scrolled", async () => {
    const { Header } = await import("@/components/Header");
    const { container } = render(<Header />);
    const header = container.querySelector(".site-header") as HTMLElement;
    expect(header.className).toBe("site-header");

    await scrollTo(120);
    expect(container.querySelector(".site-header")?.className).toBe(
      "site-header site-header--scrolled",
    );

    await scrollTo(0);
    expect(container.querySelector(".site-header")?.className).toBe("site-header");
  });

  it("keeps every menu entry reachable in both states", async () => {
    localStorage.setItem(
      IDENTITY_CACHE_KEY,
      JSON.stringify({ id: "a", username: "admin", role: "admin", active: true }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ user: { id: "a", username: "admin", role: "admin", active: true } }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    render(<Header />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Verwaltung" })).toBeInTheDocument());

    await scrollTo(300);
    for (const name of ["IHKs", "Fragen", "Fallbeispiele", "Mündliche Prüfung", "Verwaltung"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    // Sign-out and the theme toggle stay usable while compact.
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Design wechseln/ })).toBeInTheDocument();
  });
});

describe("Header — logo slot", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    } as unknown as Response);
  });

  it("renders the uploaded file as-is when a path is provided", async () => {
    const { Header } = await import("@/components/Header");
    const { container } = render(<Header logoSrc="/ihk-logo.png" />);
    const img = container.querySelector("img.brand__logo") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("/ihk-logo.png");
    // The file is used verbatim: no inline filter or style is applied to it.
    expect(img.getAttribute("style")).toBeNull();
    expect(img.style.filter).toBe("");
    // The fallback mark is not rendered alongside it.
    expect(container.querySelector(".brand__mark")).toBeNull();
  });

  it("falls back to the built-in mark when no logo file is present", async () => {
    const { Header } = await import("@/components/Header");
    const { container } = render(<Header />);
    expect(container.querySelector("img.brand__logo")).toBeNull();
    expect(container.querySelector(".brand__mark")?.textContent).toBe("IHK");
  });
});

describe("Header — dark glass stylesheet", () => {
  const header = rule(".site-header", "position: sticky");
  const inner = rule(".site-header__inner", "transition: height");
  const brandLogo = rule(".brand__logo", "object-fit: contain");
  const compact = rule(".site-header--scrolled .site-header__inner", "--header-bar-h");

  it("fixes the header to the top and keeps a constant reserved band", () => {
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
    // The band never changes height, so compacting cannot shift the page.
    expect(header).toMatch(/height:\s*var\(--header-h\)/);
    expect(css).toMatch(/--header-h:\s*\d+px/);
    // The edge gap must be the frame's own padding. As a child margin it
    // collapses through the sticky frame and disappears once pinned to the top.
    expect(header).toMatch(/padding:\s*var\(--header-pad\) 0 0/);
    expect(inner).toMatch(/margin:\s*0 auto/);
    expect(inner).not.toMatch(/margin:\s*var\(--header-pad\)/);
  });

  it("makes only the bar itself a surface (the band is click-through)", () => {
    expect(header).toMatch(/background:\s*transparent/);
    expect(header).toMatch(/pointer-events:\s*none/);
    expect(inner).toMatch(/pointer-events:\s*auto/);
  });

  it("paints dark, milky glass with a real background blur", () => {
    const glass = supportsRule(".site-header__inner");
    expect(glass).toMatch(/background:\s*var\(--hd-glass\)/);
    expect(glass).toMatch(/backdrop-filter:\s*blur\(20px\)\s*saturate\(140%\)/);
    expect(glass).toMatch(/-webkit-backdrop-filter:\s*blur\(20px\)/);
    // The fill must be translucent, or the page behind could not show through.
    const glassToken = css.match(/--hd-glass:\s*([^;]+);/);
    expect(glassToken?.[1]).toMatch(/^rgba\([^)]*0\.\d+\)$/);
  });

  it("keeps a dark fallback for browsers without backdrop-filter", () => {
    // The opaque fill is declared on the base rule, so it applies before the
    // @supports upgrade.
    expect(inner).toMatch(/background:\s*var\(--hd-solid\)/);
    const solid = css.match(/--hd-solid:\s*#([0-9a-f]{6})/i);
    expect(solid, "opaque fallback colour missing").toBeTruthy();
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(solid![1].slice(i, i + 2), 16));
    expect(r + g + b, "fallback is not dark").toBeLessThan(200);
  });

  it("adds a hairline contour and a soft shadow", () => {
    expect(inner).toMatch(/border:\s*1px solid var\(--hd-border\)/);
    expect(inner).toMatch(/box-shadow:\s*var\(--hd-shadow\)/);
    // The contour is a translucent light line, not a solid grey border.
    expect(css).toMatch(/--hd-border:\s*rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
  });

  it("shrinks height, padding, logo and spacing in the compact state", () => {
    expect(compact).toMatch(/--header-bar-h:\s*var\(--header-bar-h-compact\)/);
    expect(compact).toMatch(/--header-gap-x:\s*var\(--header-gap-x-compact\)/);
    expect(compact).toMatch(/--header-gap:\s*var\(--header-gap-compact\)/);
    expect(compact).toMatch(/--logo-h:\s*var\(--logo-h-compact\)/);
    // The edge gap sits on the frame (a sticky element's own margin collapses
    // through its frame, so the bar must not carry it).
    const frame = rule(".site-header--scrolled", "--header-pad");
    expect(frame).toMatch(/--header-pad:\s*var\(--header-pad-compact\)/);
    // Each compact value is genuinely smaller than its normal counterpart.
    const num = (name: string) => Number(css.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]);
    for (const [normal, small] of [
      ["--header-bar-h", "--header-bar-h-compact"],
      ["--logo-h", "--logo-h-compact"],
      ["--header-pad", "--header-pad-compact"],
      ["--header-gap", "--header-gap-compact"],
      ["--header-gap-x", "--header-gap-x-compact"],
      ["--header-radius", "--header-radius-compact"],
    ]) {
      expect(num(small), `${small} is not smaller than ${normal}`).toBeLessThan(num(normal));
    }
  });

  it("animates the shrink with one shared transition instead of jumping", () => {
    expect(css).toMatch(/--header-motion:\s*280ms\s+cubic-bezier/);
    for (const prop of ["height", "padding", "gap", "border-radius"]) {
      expect(inner, `no transition for ${prop}`).toMatch(
        new RegExp(`transition:[^;]*${prop}\\s+var\\(--header-motion\\)`),
      );
    }
    // The frame's edge gap animates with the same curve, so the bar does not
    // jump away from the viewport edge while it shrinks.
    expect(header).toMatch(/transition:[^;]*padding\s+var\(--header-motion\)/);
    expect(brandLogo).not.toMatch(/transition/);
    // The logo does animate — via the shared custom property on the mark/box.
    expect(rule(".brand__mark", "border-radius")).toMatch(/transition:[^;]*var\(--header-motion\)/);
  });

  it("renders the logo undistorted and unfiltered", () => {
    expect(brandLogo).toMatch(/object-fit:\s*contain/);
    expect(brandLogo).toMatch(/width:\s*auto/);
    expect(brandLogo).toMatch(/height:\s*var\(--logo-h\)/);
    expect(brandLogo).not.toMatch(/filter|transform|clip-path|object-position/);
  });

  it("shows the theme-aware active entry as a readable pill", () => {
    const active = rule(".nav a.active", "--hd-accent-soft");
    expect(active).toMatch(/background:\s*var\(--hd-accent-soft\)/);
    expect(active).toMatch(/color:\s*var\(--hd-accent-ink\)/);
  });

  it("keeps visible keyboard focus (never removed on the header controls)", () => {
    // The global :focus-visible ring is still in place and nothing in the
    // header block disables it.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    const headerBlock = css.slice(
      css.indexOf("/* ── header ──"),
      css.indexOf("/* ── hero ──"),
    );
    expect(headerBlock).not.toMatch(/outline:\s*none/);
  });

  it("respects prefers-reduced-motion", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", at));
    expect(block).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
  });
});

describe("Header — narrow viewport fit", () => {
  // Regression: at ≤424px the brand wordmark and the identity block could not
  // yield space, so the session controls were pushed past the right edge of the
  // bar and the page scrolled horizontally (measured 105px overflow at 320px).
  it("lets the identity block and the wordmark yield space", () => {
    const session = rule(".session", "margin-left: auto");
    expect(session).toMatch(/min-width:\s*0/);
    expect(session).toMatch(/flex-shrink:\s*1/);

    const user = rule(".session__user", "font-size");
    expect(user).toMatch(/min-width:\s*0/);
    expect(user).toMatch(/overflow:\s*hidden/);

    const text = rule(".brand__text", "text-overflow");
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
    expect(text).toMatch(/white-space:\s*nowrap/);
  });

  it("never clips the sign-out control", () => {
    const btn = rule(".session .btn", "flex-shrink");
    expect(btn).toMatch(/flex-shrink:\s*0/);
  });

  it("does not hide the identity behind a rule that a later base rule undoes", () => {
    // A `@media` block adds no specificity, so a later plain `.session__user`
    // rule would silently win. Assert the element is never display:none'd at
    // all, which is what the layout now relies on.
    expect(css).not.toMatch(/\.session__user\s*\{[^}]*display:\s*none/);
  });
});

describe("Header — no layout shift", () => {
  it("reserves the same vertical space in both states", () => {
    // `.page` and the login page size themselves against the constant band, so
    // the compact bar cannot pull content up.
    const page = rule(".page", "min-height");
    expect(page).toMatch(/min-height:\s*calc\(100vh - var\(--header-h\)/);
    const loginPage = rule(".login-page", "min-height");
    expect(loginPage).toMatch(/min-height:\s*calc\(100vh - var\(--header-h\)\)/);
    // The compact state only moves the bar inside the band; it never takes the
    // bar out of flow, so the page's own box is untouched.
    const compact = rule(".site-header--scrolled .site-header__inner", "--header-bar-h");
    expect(compact).not.toMatch(/position:\s*fixed|position:\s*absolute/);
  });
});
