import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage from "@/app/page";

// IHK rows across multiple Bundesländer to exercise the filter + pagination.
function ihk(id: string, name: string, bundesland: string) {
  return {
    id,
    nr: 1,
    ihkShortName: name,
    officialName: name,
    skp: null,
    bundesland,
    writtenForm: "Tablet",
    writtenResultImmediate: null,
    sameDay: null,
    intervalWrittenOral: null,
    examinerCount: null,
    groupFormat: null,
    fallbeispiel: null,
    koFallbeispiel: null,
    punktesystem: null,
    vorbereitung: null,
    notizen: null,
    dataState: null,
    lastUpdatedRaw: null,
    bezirk: null,
    adresse: null,
    telefon: null,
    website: null,
    ansprechpartner: null,
    durchwahl: null,
    email: null,
    routeUrl: null,
    sourceSheetId: "s",
  };
}

const NRW = [
  ihk("nrw-1", "Köln", "Nordrhein-Westfalen"),
  ihk("nrw-2", "Düsseldorf", "Nordrhein-Westfalen"),
  ihk("nrw-3", "Dortmund", "Nordrhein-Westfalen"),
  ihk("nrw-4", "Essen", "Nordrhein-Westfalen"),
  ihk("nrw-5", "Duisburg", "Nordrhein-Westfalen"),
  ihk("nrw-6", "Bochum", "Nordrhein-Westfalen"),
  ihk("nrw-7", "Wuppertal", "Nordrhein-Westfalen"),
  ihk("nrw-8", "Bielefeld", "Nordrhein-Westfalen"),
  ihk("nrw-9", "Bonn", "Nordrhein-Westfalen"),
  ihk("nrw-10", "Münster", "Nordrhein-Westfalen"),
  ihk("nrw-11", "Gelsenkirchen", "Nordrhein-Westfalen"),
  ihk("nrw-12", "Aachen", "Nordrhein-Westfalen"),
  ihk("nrw-13", "Mönchengladbach", "Nordrhein-Westfalen"),
  ihk("nrw-14", "Brahms", "Nordrhein-Westfalen"),
  ihk("nrw-15", "Oberhausen", "Nordrhein-Westfalen"),
];
const BAYERN = [ihk("by-1", "München", "Bayern"), ihk("by-2", "Augsburg", "Bayern")];
const HESSEN = [ihk("he-1", "Frankfurt", "Hessen")];
const ALL = [...NRW, ...BAYERN, ...HESSEN];

// Mock api.ihkList so it respects the bundesland param like the real backend.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      ihkList: vi.fn(async (params: Record<string, unknown> = {}) => {
        const limit = (params.limit as number) ?? 12;
        const page = (params.page as number) ?? 1;
        const bl = params.bundesland as string | undefined;
        const pool = bl ? ALL.filter((i) => i.bundesland === bl) : ALL;
        // The distinct-options fetch uses a large limit; return the whole pool.
        const start = (page - 1) * limit;
        const data = limit >= 100 ? pool : pool.slice(start, start + limit);
        return {
          data,
          pagination: { page, limit, total: pool.length, totalPages: Math.max(1, Math.ceil(pool.length / limit)) },
        };
      }),
      ihkSearch: vi.fn(async (q: string, page = 1, limit = 12) => {
        const pool = ALL.filter(
          (i) => i.ihkShortName.toLowerCase().includes(q.toLowerCase()),
        );
        const start = (page - 1) * limit;
        return {
          data: pool.slice(start, start + limit),
          pagination: { page, limit, total: pool.length, totalPages: Math.max(1, Math.ceil(pool.length / limit)) },
        };
      }),
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

/**
 * The IHK cards are single anchors now, so they are counted as links with the
 * card's accessible name ("<IHK> – Details anzeigen"). This also pins the
 * accessible name itself.
 */
function cards() {
  return screen.getAllByRole("link", { name: /– Details anzeigen$/ });
}

async function renderOverview() {
  const user = userEvent.setup();
  const utils = render(<HomePage />);
  // Default page (no filter): all 18 IHKs, page size 12 → first page = 12 cards.
  await waitFor(() => expect(cards()).toHaveLength(12));
  return { user, ...utils };
}

describe("overview Bundesland filter", () => {
  it("TEST 1: 'Alle Bundesländer' shows all IHKs (paginated)", async () => {
    await renderOverview();
    expect(cards()).toHaveLength(12);
    expect(screen.getByText(/18 IHK-Standorte/)).toBeInTheDocument();
  });

  it("TEST 2: selecting Nordrhein-Westfalen shows only NRW IHKs", async () => {
    const { user } = await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    await user.selectOptions(select, "Nordrhein-Westfalen");
    // NRW has 15 IHKs → page size 12 → first page = 12.
    await waitFor(() => expect(cards()).toHaveLength(12));
    expect(screen.getByText(/15 IHK-Standorte/)).toBeInTheDocument();
    expect(screen.getByText("Köln")).toBeInTheDocument();
    expect(screen.queryByText("München")).not.toBeInTheDocument();
  });

  it("TEST 3: selecting Bayern shows only Bayern IHKs", async () => {
    const { user } = await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    await user.selectOptions(select, "Bayern");
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getByText("München")).toBeInTheDocument();
    expect(screen.queryByText("Köln")).not.toBeInTheDocument();
  });

  it("TEST 4: resetting to 'Alle Bundesländer' shows all again", async () => {
    const { user } = await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    await user.selectOptions(select, "Nordrhein-Westfalen");
    await waitFor(() => expect(screen.getByText(/15 IHK-Standorte/)).toBeInTheDocument());
    await user.selectOptions(select, "");
    await waitFor(() => expect(screen.getByText(/18 IHK-Standorte/)).toBeInTheDocument());
    expect(cards()).toHaveLength(12);
  });

  it("TEST 5: no removed filters are rendered", async () => {
    const { container } = await renderOverview();
    // The only filter control is the single Bundesland <select>.
    expect(screen.queryByLabelText("Bundesland filtern")).toBeInTheDocument();
    expect(container.querySelectorAll(".filter-chip")).toHaveLength(0);
    // No filter-group labels other than "Bundesland".
    const groupLabels = [...container.querySelectorAll(".filter-group__label")].map(
      (el) => el.textContent,
    );
    expect(groupLabels).toEqual(["Bundesland"]);
    expect(screen.queryByRole("button", { name: "Zurücksetzen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter/ })).not.toBeInTheDocument();
  });

  it("TEST 6: Bundesland dropdown options are derived from data (not hardcoded)", async () => {
    await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain("Alle Bundesländer");
    expect(labels).toContain("Nordrhein-Westfalen");
    expect(labels).toContain("Bayern");
    expect(labels).toContain("Hessen");
    // Thüringen is NOT in the data → must NOT appear (proves derivation).
    expect(labels).not.toContain("Thüringen");
  });

  it("TEST 9: IHK cards have no plus symbol and link to the detail page", async () => {
    await renderOverview();
    // No compare/plus control anywhere on the overview.
    expect(screen.queryByRole("button", { name: /Vergleich/ })).not.toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    // Each card is one link to its own detail page.
    for (const card of cards()) {
      expect(card).toHaveAttribute("href", expect.stringMatching(/^\/ihk\//));
    }
  });

  it("TEST 10: the whole card is clickable and keeps working with a filter", async () => {
    const { user } = await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    // Hessen has exactly one IHK in the fixture.
    await user.selectOptions(select, "Hessen");
    await waitFor(() => expect(cards()).toHaveLength(1));
    for (const card of cards()) {
      expect(card).toHaveAttribute("href", expect.stringMatching(/^\/ihk\//));
    }
    // Cards remain reachable for keyboard users (focusable anchors).
    const [first] = cards();
    first.focus();
    expect(first).toHaveFocus();
  });

  it("TEST P1: pagination works WITHOUT filter (all 18 → 2 pages)", async () => {
    const { user } = await renderOverview();
    // Page 1 shows 12 of 18; page 2 button exists.
    expect(cards()).toHaveLength(12);
    const page2 = screen.getByRole("button", { name: "Seite 2" });
    await user.click(page2);
    await waitFor(() => expect(cards()).toHaveLength(6));
  });

  it("TEST P2: pagination works WITH the NRW filter (15 → 2 pages)", async () => {
    const { user } = await renderOverview();
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    await user.selectOptions(select, "Nordrhein-Westfalen");
    await waitFor(() => expect(screen.getByText(/15 IHK-Standorte/)).toBeInTheDocument());
    expect(cards()).toHaveLength(12);
    const page2 = screen.getByRole("button", { name: "Seite 2" });
    await user.click(page2);
    await waitFor(() => expect(cards()).toHaveLength(3));
    // Going back to page 1 restores the first 12.
    const page1 = screen.getByRole("button", { name: "Seite 1" });
    await user.click(page1);
    await waitFor(() => expect(cards()).toHaveLength(12));
  });

  it("IHK card data remains complete (bundesland + attrs shown)", async () => {
    const { container } = await renderOverview();
    const first = container.querySelector(".ihk-card") as HTMLElement;
    expect(within(first).getByText("Köln")).toBeInTheDocument();
    // The card renders the bundesland display.
    expect(first.textContent).toContain("Nordrhein-Westfalen");
    // Schriftlich attr is still present (data preserved).
    expect(first.textContent).toContain("Tablet");
  });
});
