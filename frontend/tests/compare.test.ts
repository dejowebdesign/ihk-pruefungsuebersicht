import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCompareIds,
  saveCompareIds,
  clearCompareIds,
  toggleCompareId,
  COMPARE_STORAGE_KEY,
  MAX_COMPARE,
} from "@/lib/compare";

beforeEach(() => {
  localStorage.clear();
});

describe("compare storage", () => {
  it("loadCompareIds returns [] when nothing is stored", () => {
    expect(loadCompareIds()).toEqual([]);
  });

  it("saveCompareIds persists and loadCompareIds round-trips", () => {
    saveCompareIds(["a", "b", "c"]);
    expect(loadCompareIds()).toEqual(["a", "b", "c"]);
  });

  it("clamps to MAX_COMPARE on save", () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    saveCompareIds(ids);
    expect(loadCompareIds()).toHaveLength(MAX_COMPARE);
    expect(loadCompareIds()).toEqual(["1", "2", "3", "4"]);
  });

  it("de-duplicates on load", () => {
    localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(["a", "a", "b", "b"]),
    );
    expect(loadCompareIds()).toEqual(["a", "b"]);
  });

  it("ignores malformed JSON / non-array storage", () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, "not-json");
    expect(loadCompareIds()).toEqual([]);
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadCompareIds()).toEqual([]);
  });

  it("ignores non-string entries on load", () => {
    localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(["a", 1, null, "b"]),
    );
    expect(loadCompareIds()).toEqual(["a", "b"]);
  });

  it("clearCompareIds empties storage", () => {
    saveCompareIds(["a", "b"]);
    clearCompareIds();
    expect(loadCompareIds()).toEqual([]);
    expect(localStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
  });
});

describe("toggleCompareId (pure)", () => {
  it("adds an id when not present", () => {
    expect(toggleCompareId([], "a")).toEqual(["a"]);
    expect(toggleCompareId(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id when present (order of others preserved)", () => {
    expect(toggleCompareId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("blocks adding beyond MAX_COMPARE", () => {
    const full = ["1", "2", "3", "4"];
    expect(toggleCompareId(full, "5")).toEqual(full);
  });

  it("still allows removing when at the limit", () => {
    const full = ["1", "2", "3", "4"];
    expect(toggleCompareId(full, "2")).toEqual(["1", "3", "4"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    const next = toggleCompareId(input, "c");
    expect(input).toEqual(["a", "b"]);
    expect(next).toEqual(["a", "b", "c"]);
  });

  it("never exceeds MAX_COMPARE", () => {
    let ids: string[] = [];
    for (let i = 1; i <= 10; i++) ids = toggleCompareId(ids, `id-${i}`);
    expect(ids).toHaveLength(MAX_COMPARE);
    expect(ids).toEqual(["id-1", "id-2", "id-3", "id-4"]);
  });
});
