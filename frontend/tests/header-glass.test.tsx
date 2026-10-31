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

describe("Header — dark glass stylesheet", () => {
  const header = rule(".site-header", "position: sticky");
  const inner = rule(".site-header__inner", "transition: width");
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

  it("is full-bleed at the top and only narrows once scrolled", () => {
    // The primary motion is horizontal: 100% → ~90%, centred, with the compact
    // width capped so it never becomes a letterbox on very wide monitors.
    expect(css).toMatch(/--header-width:\s*100%/);
    expect(css).toMatch(/--header-width-compact:\s*9\d%/);
    expect(css).toMatch(/--header-maxw-compact:\s*1440px/);
    // The cap must NOT apply at the top, or a >1440px screen would not be
    // full-bleed.
    expect(css).toMatch(/--header-maxw:\s*100%/);
    expect(inner).toMatch(/width:\s*var\(--header-width\)/);
    expect(inner).toMatch(/max-width:\s*min\(var\(--header-maxw\)/);
    expect(compact).toMatch(/--header-width:\s*var\(--header-width-compact\)/);
    expect(compact).toMatch(/--header-maxw:\s*var\(--header-maxw-compact\)/);
    // The compact height drop is modest (the bar stays comfortable), while the
    // width shrinks far more — this is the whole point of the redesign.
    const num = (name: string) => Number(css.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]);
    const heightDrop = 1 - num("--header-bar-h-compact") / num("--header-bar-h");
    expect(heightDrop, "compact bar loses too much height").toBeLessThan(0.2);
    expect(num("--header-bar-h-compact")).toBeGreaterThanOrEqual(80);
  });

  it("keeps a stable three-column track that centres the navigation", () => {
    // Equal outer tracks are what centre the nav on the bar; `auto 1fr auto`
    // shifts it whenever the logo and the identity block differ in width. The
    // `minmax(0, …)` floor is required: without it the tracks refuse to shrink
    // and the identity block overflows the bar on a phone.
    expect(inner).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
    const center = rule(".header__center", "justify-content");
    expect(center).toMatch(/justify-content:\s*center/);
  });

  it("collapses the empty middle track once the hamburger takes over", () => {
    // Below the nav breakpoint the inline nav is gone, so the centre track must
    // yield its half of the bar to the identity block. It is collapsed to zero
    // width rather than `display:none`d, because the mobile dropdown is a child
    // of the centre box and would be hidden with it.
    const at = css.indexOf("@media (max-width: 1049px)");
    expect(at, "nav breakpoint missing").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", at));
    expect(block).toMatch(/grid-template-columns:\s*auto\s+0\s+minmax\(0,\s*1fr\)/);
    expect(block).not.toMatch(/\.header__center\s*\{[^}]*display:\s*none/);
  });

  it("pins the theme toggle to the right in every state", () => {
    // The actions column ends with the toggle, and the toggle pushes itself to
    // the far right, so it is the rightmost control signed out, as admin and as
    // examiner — the bug this redesign fixes.
    const toggle = rule(".theme-toggle", "margin-left");
    expect(toggle).toMatch(/margin-left:\s*auto/);
    const actions = rule(".header__actions", "display: flex");
    expect(actions).toMatch(/align-items:\s*center/);
  });

  it("makes only the bar itself a surface (the band is click-through)", () => {
    expect(header).toMatch(/background:\s*transparent/);
    expect(header).toMatch(/pointer-events:\s*none/);
    expect(inner).toMatch(/pointer-events:\s*auto/);
  });

  it("paints dark, milky glass with a real background blur", () => {
    const glass = supportsRule(".site-header__inner");
    expect(glass).toMatch(/background:\s*var\(--hd-glass\)/);
    expect(glass).toMatch(/backdrop-filter:\s*blur\(20px\)\s*saturate\(155%\)/);
    expect(glass).toMatch(/-webkit-backdrop-filter:\s*blur\(20px\)/);
    // The fill must be translucent, or the page behind could not show through.
    const glassToken = css.match(/--hd-glass:\s*([^;]+);/);
    expect(glassToken?.[1]).toMatch(/^rgba\([^)]*0\.\d+\)$/);
  });

  it("keeps the fill translucent enough for the page to show through", () => {
    // The brief asked for a brighter, more transparent bar. The alpha must be
    // clearly below the old near-opaque 0.72/0.84 pair, the compact tint must
    // still be denser than the top one, and — because "gute Lesbarkeit" is part
    // of the brief — the top alpha must stay at the level where the nav label
    // still clears WCAG AA (4.5:1) over the lightest surface the sticky bar can
    // scroll across. 0.58 (as suggested) measured 3.99:1 there, so 0.64 is the
    // floor.
    const alpha = (name: string) =>
      Number(css.match(new RegExp(`${name}:\\s*rgba\\([^)]*,\\s*(0\\.\\d+)\\)`))?.[1]);
    const top = alpha("--hd-glass");
    const compact = alpha("--hd-glass-strong");
    expect(top, "--hd-glass not translucent enough").toBeLessThan(0.7);
    expect(top, "--hd-glass below the AA-safe floor").toBeGreaterThanOrEqual(0.64);
    expect(compact, "--hd-glass-strong not translucent enough").toBeLessThan(0.76);
    expect(compact, "compact tint must stay denser than the top bar").toBeGreaterThan(top);
    // Brighter anthracite/navy: the old fills were rgb(11,18,33)/rgb(9,16,30).
    expect(css).toMatch(/--hd-glass:\s*rgba\(19,\s*30,\s*47,/);
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

  it("shrinks width, height, padding, logo and spacing in the compact state", () => {
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
      ["--header-gap", "--header-gap-compact"],
      ["--header-gap-x", "--header-gap-x-compact"],
    ]) {
      expect(num(small), `${small} is not smaller than ${normal}`).toBeLessThan(num(normal));
    }
    // Two values grow rather than shrink, and are asserted directly: the bar
    // gains rounding as it detaches from the screen edge, and gains a real
    // floating gap (0 at the top → 10px when scrolled).
    expect(num("--header-radius")).toBe(0);
    expect(num("--header-radius-compact")).toBeGreaterThan(0);
    expect(num("--header-pad-compact")).toBeGreaterThan(num("--header-pad"));
  });

  it("animates the shrink with one shared transition instead of jumping", () => {
    expect(css).toMatch(/--header-motion:\s*\d+ms\s+cubic-bezier/);
    for (const prop of ["width", "height", "padding", "border-radius"]) {
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

  it("does not render the removed wordmark next to the logo", async () => {
    const { Header } = await import("@/components/Header");
    const { container } = render(<Header logoSrc="/ihk-logo.png" />);
    // The old "Prüfungsübersicht" label beside the logo is gone for good.
    expect(container.querySelector(".brand__text")).toBeNull();
    expect(container.textContent).not.toContain("Prüfungsübersicht");
    // …and the rule was removed from the stylesheet too.
    expect(css).not.toMatch(/\.brand__text\s*\{/);
  });
});

describe("Header — identity block", () => {
  it("shows only the role badge, never the username", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ user: { id: "a", username: "admin", role: "admin", active: true } }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    const { container } = render(<Header />);
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());
    // The single badge carries the role; the account name is not shown at all —
    // not as text and not in a tooltip.
    const badge = container.querySelector(".session__role--admin");
    expect(badge?.textContent).toBe("Administrator");
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
    expect(container.querySelector(".session__name")).toBeNull();
    expect(container.querySelector(".session__user")).toBeNull();
    expect(container.querySelector("[title*='admin']")).toBeNull();
  });

  it("labels the examiner role as Prüfer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ user: { id: "u1", username: "anna", role: "examiner", active: true } }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    const { container } = render(<Header />);
    await waitFor(() => expect(screen.getByText("Prüfer")).toBeInTheDocument());
    expect(container.querySelector(".session__role--examiner")?.textContent).toBe("Prüfer");
    expect(screen.queryByText("anna")).not.toBeInTheDocument();
  });
});

describe("Header — narrow viewport fit", () => {
  // Regression: the identity block could not yield space and pushed the
  // sign-out control past the right edge of the bar (measured overflow at 320px
  // and 390px). The layout now sheds the logout word and steps the chip down.
  it("lets the identity block yield space", () => {
    const session = rule(".session", "gap: 10px");
    expect(session).toMatch(/min-width:\s*0/);
    expect(session).toMatch(/flex-shrink:\s*1/);
  });

  it("never clips the sign-out control", () => {
    const btn = rule(".session .btn", "flex-shrink");
    expect(btn).toMatch(/flex-shrink:\s*0/);
  });

  it("drops the logout word on small screens and keeps an accessible name", async () => {
    // The label is a span that is hidden ≤560px; the button keeps
    // `aria-label="Abmelden"`, so the accessible name is unchanged.
    const at = css.lastIndexOf("@media (max-width: 560px)");
    expect(at, "narrow identity block missing").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", at));
    expect(block).toMatch(/\.session__logout-text\s*\{\s*display:\s*none/);

    const { Header } = await import("@/components/Header");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ user: { id: "a", username: "admin", role: "admin", active: true } }),
    } as unknown as Response);
    render(<Header />);
    const logout = await screen.findByRole("button", { name: "Abmelden" });
    expect(logout.querySelector(".session__logout-text")?.textContent).toBe("Abmelden");
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

describe("Header — band matches the visible bar", () => {
  it("reserves exactly the bar's height, with no dead space", () => {
    // The old band was 116px while the bar was only 96px, so 20px of empty
    // header container sat between the bar and the first page block. The band
    // and the bar must now agree, or a full-bleed hero cannot sit flush.
    const band = Number(css.match(/--header-h:\s*(\d+)px/)?.[1]);
    const bar = Number(css.match(/--header-bar-h:\s*(\d+)px/)?.[1]);
    expect(band, "--header-h must equal --header-bar-h").toBe(bar);
  });

  it("drops the page's top padding only when a full-bleed band leads", () => {
    // The start page hero paints its own top padding, so `.page`'s 28px would
    // read as an empty strip under the bar. Scoped with `:has()` so every other
    // page keeps its spacing.
    const flush = rule(".page:has(> .hero)", "padding-top");
    expect(flush).toMatch(/padding-top:\s*0/);
    // The default padding is untouched for every other page.
    expect(rule(".page", "padding: 28px")).toMatch(/padding:\s*28px 0 56px/);
    // The hero must still own its own top padding — the gap is removed, not
    // simply replaced by a touching edge.
    const hero = rule(".hero", "background-position");
    expect(hero).toMatch(/padding:\s*\d+px 0/);
  });

  it("keeps the band equal to the bar at every breakpoint", () => {
    // The phone block shortens the bar to 84px; if `--header-h` did not follow,
    // the band would reserve 12px of dead space between the bar and the hero —
    // the very gap this order removes, only on mobile.
    const at = css.indexOf("@media (max-width: 768px)");
    expect(at, "phone breakpoint missing").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", at));
    const band = Number(block.match(/--header-h:\s*(\d+)px/)?.[1]);
    const bar = Number(block.match(/--header-bar-h:\s*(\d+)px/)?.[1]);
    expect(band, "mobile --header-h must equal --header-bar-h").toBe(bar);
  });
});

describe("Back to top", () => {
  it("is hidden at the top, shown after scrolling, and returns to the top", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    } as unknown as Response);
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollToSpy, configurable: true, writable: true });

    const { BackToTop } = await import("@/components/BackToTop");
    const { container } = render(<BackToTop />);
    const btn = container.querySelector(".to-top") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Zurück nach oben");
    expect(btn.className).not.toContain("to-top--visible");

    await scrollTo(420 + 200);
    expect(container.querySelector(".to-top")?.className).toContain("to-top--visible");

    btn.click();
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    await scrollTo(0);
    expect(container.querySelector(".to-top")?.className).not.toContain("to-top--visible");
  });

  it("styles the control as a round floating glass button", () => {
    const base = rule(".to-top", "position: fixed");
    expect(base).toMatch(/border-radius:\s*999px/);
    expect(base).toMatch(/opacity:\s*0/);
    expect(base).toMatch(/pointer-events:\s*none/);
    const shown = rule(".to-top--visible", "opacity: 1");
    expect(shown).toMatch(/visibility:\s*visible/);
    expect(shown).toMatch(/pointer-events:\s*auto/);
    // Dark glass, matching the header: the `@supports` upgrade on `.to-top`
    // adds a real background blur.
    expect(css).toMatch(/\.to-top\s*\{[^}]*backdrop-filter:\s*blur\(/);
  });
});
