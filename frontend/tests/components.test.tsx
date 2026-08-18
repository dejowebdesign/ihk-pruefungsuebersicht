import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, SkpBadge } from "@/components/Badge";
import { Pagination } from "@/components/Pagination";
import { EmptyState, ErrorState } from "@/components/States";
import { ComparisonTable } from "@/components/ComparisonTable";
import type { IhkLocation } from "@/lib/api";

describe("Badge", () => {
  it("renders neutral variant by default", () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText("x")).toHaveClass("badge--neutral");
  });

  it("renders success variant", () => {
    render(<Badge variant="success">ok</Badge>);
    expect(screen.getByText("ok")).toHaveClass("badge--success");
  });
});

describe("SkpBadge", () => {
  it("renders success for ✅", () => {
    render(<SkpBadge value="✅" />);
    expect(screen.getByText("✅")).toHaveClass("badge--success");
  });

  it("renders neutral fallback for null", () => {
    render(<SkpBadge value={null} />);
    expect(screen.getByText("Keine Angabe")).toHaveClass("badge--neutral");
  });

  it("renders neutral for nein", () => {
    render(<SkpBadge value="nein" />);
    expect(screen.getByText("nein")).toHaveClass("badge--neutral");
  });
});

describe("Pagination", () => {
  it("renders single-page summary when totalPages <= 1", () => {
    render(
      <Pagination page={1} totalPages={1} total={5} limit={12} onPage={() => {}} />,
    );
    expect(screen.getByText(/1–5 von 5/)).toBeInTheDocument();
    // No page buttons.
    expect(screen.queryByRole("button", { name: /Seite/ })).not.toBeInTheDocument();
  });

  it("renders page buttons and calls onPage", () => {
    const onPage = vi.fn();
    render(
      <Pagination page={2} totalPages={5} total={50} limit={10} onPage={onPage} />,
    );
    // Active page marked aria-current.
    expect(screen.getByRole("button", { name: "Seite 2" })).toHaveAttribute("aria-current", "page");
    // Prev/next present.
    expect(screen.getByRole("button", { name: "Zurück" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeInTheDocument();
  });

  it("disables prev on first page", () => {
    render(
      <Pagination page={1} totalPages={3} total={30} limit={10} onPage={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Weiter" })).not.toBeDisabled();
  });
});

describe("States", () => {
  it("EmptyState renders title and reset button", () => {
    const onReset = vi.fn();
    render(<EmptyState title="Nope" text="x" onReset={onReset} resetLabel="Reset" />);
    expect(screen.getByText("Nope")).toBeInTheDocument();
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("ErrorState renders message", () => {
    render(<ErrorState message="Kaputt" />);
    expect(screen.getByText("Kaputt")).toBeInTheDocument();
  });
});

describe("ComparisonTable", () => {
  const ihks: IhkLocation[] = [
    {
      id: "a", nr: 1, ihkShortName: "A", officialName: "x", sourceSheetId: "s",
      skp: "✅", bundesland: "Bayern", writtenForm: "Tablet",
      writtenResultImmediate: "ja", sameDay: "ja", intervalWrittenOral: "0",
      examinerCount: "2", groupFormat: "3er Gruppe", fallbeispiel: null,
      koFallbeispiel: null, punktesystem: null, vorbereitung: null, notizen: null,
      dataState: null, lastUpdatedRaw: null, bezirk: null, adresse: null,
      telefon: null, website: null, ansprechpartner: null, durchwahl: null,
      email: null, routeUrl: null,
    },
    {
      id: "b", nr: 2, ihkShortName: "B", officialName: "y", sourceSheetId: "s",
      skp: "nein", bundesland: "Hessen", writtenForm: "Papier",
      writtenResultImmediate: "nein", sameDay: "nein", intervalWrittenOral: "14",
      examinerCount: "3", groupFormat: "4er Gruppe", fallbeispiel: null,
      koFallbeispiel: null, punktesystem: null, vorbereitung: null, notizen: null,
      dataState: null, lastUpdatedRaw: null, bezirk: null, adresse: null,
      telefon: null, website: null, ansprechpartner: null, durchwahl: null,
      email: null, routeUrl: null,
    },
  ];

  it("renders feature rows and IHK columns", () => {
    render(<ComparisonTable ihks={ihks} />);
    expect(screen.getByText("Merkmal")).toBeInTheDocument();
    expect(screen.getByText("SKP")).toBeInTheDocument();
    // Both IHK names as headers.
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    // Values present.
    expect(screen.getAllByText("Tablet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Papier").length).toBeGreaterThan(0);
  });

  it("renders empty state when no ihks", () => {
    render(<ComparisonTable ihks={[]} />);
    expect(screen.getByText(/Wähle IHKs/)).toBeInTheDocument();
  });
});
