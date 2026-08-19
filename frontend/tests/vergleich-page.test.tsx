import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import VergleichPage from "@/app/vergleich/page";
import { COMPARE_STORAGE_KEY } from "@/lib/compare";

function ihkDetail(id: string, name: string) {
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
    sourceSheet: { id: "s", originalName: "S", gid: "0", sheetType: "ihk" },
    importRun: { id: "r", startedAt: "t", finishedAt: "t" },
    semantics: [],
  };
}

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      ihkDetail: vi.fn(async (id: string) => ihkDetail(id, `IHK-${id}`)),
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("/vergleich reads localStorage selection", () => {
  it("TEST 6: direct visit with no selection shows empty state", async () => {
    render(<VergleichPage />);
    await waitFor(() => {
      expect(
        screen.getByText("Keine IHKs zum Vergleichen ausgewählt"),
      ).toBeInTheDocument();
    });
  });

  it("reads selection from localStorage and renders those IHKs", async () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["a", "b"]));
    render(<VergleichPage />);
    // Selected IHKs surface as remove-chips with aria-label "<short> entfernen".
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "IHK-a entfernen" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "IHK-b entfernen" })).toBeInTheDocument();
    });
  });

  it("TEST 7: selection survives a reload (re-mounted page re-reads storage)", async () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(["a", "b"]));
    // First mount.
    const r1 = render(<VergleichPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "IHK-a entfernen" })).toBeInTheDocument(),
    );
    r1.unmount();
    // Simulate a reload by remounting fresh; storage still holds the ids.
    render(<VergleichPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "IHK-a entfernen" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "IHK-b entfernen" })).toBeInTheDocument();
    });
  });

  it("clamps to MAX_COMPARE and ignores a 5th id", async () => {
    localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(["1", "2", "3", "4", "5"]),
    );
    render(<VergleichPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "IHK-1 entfernen" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "IHK-5 entfernen" })).not.toBeInTheDocument();
    const removeChips = ["1", "2", "3", "4", "5"].map((n) =>
      screen.queryByRole("button", { name: `IHK-${n} entfernen` }),
    ).filter(Boolean);
    expect(removeChips).toHaveLength(4);
  });
});
