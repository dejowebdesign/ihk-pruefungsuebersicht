import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const css = readFileSync(resolve(root, "src/styles/globals.css"), "utf8");

/** Body of the first `.hero { … }` rule, at top level of the stylesheet. */
function heroRule(): string {
  const start = css.indexOf(".hero {");
  expect(start, ".hero rule not found").toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

/** Body of the `.hero` override inside a `@media` block, found by width. */
function heroRuleInMedia(maxWidth: number): string {
  const media = `@media (max-width: ${maxWidth}px)`;
  const at = css.indexOf(media);
  expect(at, `${media} not found`).toBeGreaterThan(-1);
  // The hero override lives inside this media block, before the next one.
  const next = css.indexOf("@media", at + media.length);
  const block = css.slice(at, next === -1 ? css.length : next);
  const start = block.indexOf(".hero {");
  expect(start, `.hero override not found in ${media}`).toBeGreaterThan(-1);
  return block.slice(start, block.indexOf("}", start));
}

describe("hero background image", () => {
  const hero = heroRule();

  it("ships the referenced image in public/", () => {
    const file = resolve(root, "public/hero.png");
    expect(existsSync(file)).toBe(true);
    // A placeholder/empty file would still "exist", so require real bytes.
    expect(statSync(file).size).toBeGreaterThan(100_000);
  });

  it("references the image by an absolute /-rooted URL", () => {
    expect(hero).toContain('url("/hero.png")');
  });

  it("uses background-size: cover so the image is never distorted", () => {
    expect(hero).toMatch(/background-size:\s*cover/);
    // Both layers (scrim + photo) must be covered; a stray `contain` or a bare
    // numeric size would stretch the photo.
    expect(hero).not.toMatch(/background-size:[^;]*contain/);
    expect(hero).not.toMatch(/background-size:[^;]*\d+(px|%|em|rem)/);
  });

  it("anchors the photo to the right so the officer stays in frame", () => {
    expect(hero).toMatch(/background-position:\s*center,\s*right center/);
  });

  it("repeats neither the scrim nor the photo", () => {
    expect(hero).toMatch(/background-repeat:\s*no-repeat,\s*no-repeat/);
  });

  it("keeps a dark scrim over the photo for text contrast", () => {
    expect(hero).toMatch(/linear-gradient\(\s*90deg/);
    // The left side (where the text sits) must be the darkest part.
    const leftStop = hero.match(/90deg,\s*rgba\([^)]*\)\s*0%/);
    expect(leftStop, "no left-most gradient stop").not.toBeNull();
    const alpha = Number(leftStop![0].match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)![1]);
    expect(alpha).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps a fallback background colour behind the photo", () => {
    expect(hero).toMatch(/background-color:\s*var\(--bg-subtle\)/);
  });

  it("does not paint the frosted glass band over the photo", () => {
    // The old hero used backdrop-filter; it would blur the image behind it.
    expect(hero).not.toContain("backdrop-filter");
    expect(hero).not.toContain("glass-strong");
  });
});

describe("hero text stays readable over the photo", () => {
  it("renders the heading in a light colour in both themes", () => {
    const rule = css.slice(css.indexOf(".hero__title {"));
    const body = rule.slice(0, rule.indexOf("}"));
    // A var(--text) colour would be dark in light mode and vanish on the scrim.
    expect(body).not.toMatch(/color:\s*var\(--text\)/);
    expect(body).toMatch(/color:\s*#[0-9a-fA-F]{6}/);
  });

  it("gives the heading and subtitle a text shadow for contrast", () => {
    for (const sel of [".hero__title {", ".hero__subtitle {", ".hero__note {"]) {
      const at = css.indexOf(sel);
      expect(at, `${sel} missing`).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf("}", at))).toContain("text-shadow");
    }
  });

  it("styles the note via a class rather than an inline style", () => {
    const page = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
    expect(page).toContain('className="hero__note"');
    // An inline colour would override the stylesheet rule above.
    expect(page).not.toMatch(/<p\s+style=\{\{[^}]*color:\s*"var\(--text-muted\)"/);
  });
});

describe("hero stays responsive", () => {
  it("re-asserts the photo and scrim at the mobile breakpoint", () => {
    const mobile = heroRuleInMedia(768);
    expect(mobile).toContain('url("/hero.png")');
    expect(mobile).toMatch(/linear-gradient/);
  });

  it("darkens the scrim more evenly on narrow viewports", () => {
    const mobile = heroRuleInMedia(768);
    const alphas = [...mobile.matchAll(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(alphas.length).toBeGreaterThanOrEqual(3);
    // The right-hand stop must still be dark enough for full-width text.
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps the existing responsive hero padding", () => {
    expect(heroRuleInMedia(768)).toMatch(/padding:\s*34px 0 26px/);
  });
});

describe("hero markup is preserved", () => {
  it("keeps the heading, subtitle and search field as real elements", () => {
    const page = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
    expect(page).toContain('<h1 className="hero__title">IHK Prüfungsübersicht</h1>');
    expect(page).toContain("Sachkundeprüfung §34a");
    expect(page).toContain("<SearchBar");
    expect(page).toContain('<section className="hero">');
  });
});
