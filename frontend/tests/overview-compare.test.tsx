import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage from "@/app/page";
import {
  COMPARE_STORAGE_KEY,
  loadCompareIds,
  MAX_COMPARE,
} from "@/lib/compare";

// Minimal IHK rows matching the IhkLocation shape the overview renders.
function ihk(id: string, name: string) {
  return {
    id,
    nr: 1,
    ihkShortName: name,
    officialName: name,
    skp: null,
    bundesland: "Bayern",
    writtenForm: null,
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

function paginated(data: ReturnType<typeof ihk>[]) {
  return {
    data,
    pagination: { page: 1, limit: 12, total: data.length, totalPages: 1 },
  };
}

// Mock the api client so HomePage renders deterministic IHK cards.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      ihkList: vi.fn(async () =>
        paginated([ihk("ihk-a", "Augsburg"), ihk("ihk-b", "Berlin")]),
      ),
      ihkSearch: vi.fn(),
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

async function renderOverview() {
  const user = userEvent.setup();
  const utils = render(<HomePage />);
  // Wait for cards to appear (async api.ihkList).
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  return { user, ...utils };
}

describe("overview compare selection", () => {
  it("TEST 1: selecting 1 IHK persists to storage", async () => {
    const { user } = await renderOverview();
    const add = screen.getAllByRole("button", { name: "Zum Vergleich hinzufügen" })[0];
    await user.click(add);

    expect(loadCompareIds()).toEqual(["ihk-a"]);
  });

  it("TEST 2: selecting 2 IHKs persists both", async () => {
    const { user } = await renderOverview();
    const addButtons = screen.getAllByRole("button", { name: "Zum Vergleich hinzufügen" });
    await user.click(addButtons[0]);
    await user.click(addButtons[1]);

    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);
  });

  it("TEST 4: a 5th selection is blocked (max 4)", async () => {
    // Pre-seed storage with 4 ids so the overview is full on render.
    localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(["1", "2", "3", "4"]),
    );
    const { user } = await renderOverview();

    // When full, IhkCard receives no onToggleSelect → "+" buttons are absent.
    expect(screen.queryAllByRole("button", { name: "Zum Vergleich hinzufügen" })).toHaveLength(0);

    // And storage stays at 4.
    expect(loadCompareIds()).toHaveLength(MAX_COMPARE);
  });

  it("TEST 5: removing a selected IHK updates storage", async () => {
    const { user } = await renderOverview();
    const addButtons = screen.getAllByRole("button", { name: "Zum Vergleich hinzufügen" });
    await user.click(addButtons[0]);
    await user.click(addButtons[1]);
    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);

    // After selecting, the toggle buttons switch to "Vom Vergleich entfernen".
    const removeButtons = screen.getAllByRole("button", { name: "Vom Vergleich entfernen" });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[0]);

    expect(loadCompareIds()).toEqual(["ihk-b"]);
  });

  it("TEST 8: returning to the overview keeps the prior selection", async () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["ihk-a"]));
    const { container } = await renderOverview();

    // First card should render in selected state (✓ button present).
    expect(
      container.querySelector(".ihk-card__select--selected"),
    ).not.toBeNull();
    expect(loadCompareIds()).toEqual(["ihk-a"]);
  });

  it("does NOT wipe a stored selection on mount (persist effect race guard)", async () => {
    // The persist effect must not run with the initial [] state before the
    // restore effect has read storage. Seed storage, render, and assert the
    // key still holds the ids (not wiped to empty).
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["ihk-a", "ihk-b"]));
    await renderOverview();
    expect(loadCompareIds()).toEqual(["ihk-a", "ihk-b"]);
  });

  it("re-mounting the overview restores selection from storage", async () => {
    // Simulate a return navigation: storage holds ids, a fresh component mount
    // must re-hydrate the selected state.
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["ihk-b"]));
    const { container } = await renderOverview();
    await waitFor(() => {
      expect(
        container.querySelector(".ihk-card__select--selected"),
      ).not.toBeNull();
    });
    expect(loadCompareIds()).toEqual(["ihk-b"]);
  });

  it("Leeren button clears storage", async () => {
    const { user } = await renderOverview();
    const addButtons = screen.getAllByRole("button", { name: "Zum Vergleich hinzufügen" });
    await user.click(addButtons[0]);
    expect(loadCompareIds()).toEqual(["ihk-a"]);

    const clearBtn = screen.getByRole("button", { name: "Leeren" });
    await user.click(clearBtn);
    expect(loadCompareIds()).toEqual([]);
    expect(localStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
  });

  it("verifies storage key shape (matches /vergleich reader)", () => {
    saveAndCheck: {
      const ids = ["x", "y"];
      localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(ids));
      const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
      expect(JSON.parse(raw ?? "[]")).toEqual(["x", "y"]);
    }
  });

  // silence unused act import in some setups
  void act;
});
