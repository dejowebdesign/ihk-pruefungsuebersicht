import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "@/components/SearchBar";
import { BundeslandFilter } from "@/components/FilterPanel";

describe("SearchBar", () => {
  it("debounces onChange (real timers)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="" onChange={onChange} debounceMs={50} />);

    const input = screen.getByLabelText("IHK suchen") as HTMLInputElement;
    await user.type(input, "hi");

    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(onChange).toHaveBeenCalledWith("hi");
  });

  it("shows clear button and clears", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="test" onChange={onChange} debounceMs={0} />);
    const clear = screen.getByRole("button", { name: "Suche löschen" });
    await user.click(clear);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("syncs external value into the input", () => {
    const { rerender } = render(<SearchBar value="abc" onChange={() => {}} />);
    const input = screen.getByLabelText("IHK suchen") as HTMLInputElement;
    expect(input.value).toBe("abc");
    rerender(<SearchBar value="xyz" onChange={() => {}} />);
    expect(input.value).toBe("xyz");
  });
});

describe("BundeslandFilter", () => {
  const OPTIONS = ["Bayern", "Hessen", "Nordrhein-Westfalen"];

  it("renders 'Alle Bundesländer' plus the derived options", () => {
    render(<BundeslandFilter value="" options={OPTIONS} onChange={() => {}} />);
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Alle Bundesländer",
      "Bayern",
      "Hessen",
      "Nordrhein-Westfalen",
    ]);
  });

  it("selecting an option calls onChange with that Bundesland", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BundeslandFilter value="" options={OPTIONS} onChange={onChange} />);
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    await user.selectOptions(select, "Nordrhein-Westfalen");
    expect(onChange).toHaveBeenCalledWith("Nordrhein-Westfalen");
  });

  it("resetting back to 'Alle Bundesländer' calls onChange with empty string", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <BundeslandFilter value="Nordrhein-Westfalen" options={OPTIONS} onChange={onChange} />,
    );
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    expect(select.value).toBe("Nordrhein-Westfalen");
    await user.selectOptions(select, "");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does NOT render any of the removed filter chips", () => {
    render(<BundeslandFilter value="" options={OPTIONS} onChange={() => {}} />);
    expect(screen.queryByText("SKP verfügbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Schriftliche Prüfungsform")).not.toBeInTheDocument();
    expect(screen.queryByText("Ergebnis sofort")).not.toBeInTheDocument();
    expect(screen.queryByText("Gleicher Tag")).not.toBeInTheDocument();
    expect(screen.queryByText("Gruppenformat")).not.toBeInTheDocument();
  });

  it("derives options from provided data (no hardcoded list)", () => {
    render(<BundeslandFilter value="" options={["Bayern"]} onChange={() => {}} />);
    const select = screen.getByLabelText("Bundesland filtern") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Alle Bundesländer",
      "Bayern",
    ]);
  });
});
