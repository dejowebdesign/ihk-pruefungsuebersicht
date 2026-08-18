import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "@/components/SearchBar";
import { FilterPanel, EMPTY_FILTERS, hasActiveFilters } from "@/components/FilterPanel";

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

describe("FilterPanel", () => {
  it("toggles a chip and calls onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterPanel values={EMPTY_FILTERS} onChange={onChange} onReset={() => {}} />);

    const chip = screen.getByRole("button", { name: "Bayern" });
    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bundesland: "Bayern" }));
  });

  it("deselects active chip on second click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterPanel
        values={{ ...EMPTY_FILTERS, bundesland: "Bayern" }}
        onChange={onChange}
        onReset={() => {}}
      />,
    );
    const chip = screen.getByRole("button", { name: "Bayern" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bundesland: "" }));
  });

  it("renders reset button only when filters active", () => {
    const { rerender } = render(
      <FilterPanel values={EMPTY_FILTERS} onChange={() => {}} onReset={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Zurücksetzen" })).not.toBeInTheDocument();

    rerender(
      <FilterPanel
        values={{ ...EMPTY_FILTERS, skp: "✅" }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Zurücksetzen" })).toBeInTheDocument();
  });

  it("hasActiveFilters detects empty and non-empty", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, skp: "✅" })).toBe(true);
  });
});
