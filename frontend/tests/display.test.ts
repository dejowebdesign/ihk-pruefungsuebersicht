import { describe, it, expect } from "vitest";
import { display, isMissing } from "@/components/display";

describe("display helpers", () => {
  it("display renders null as fallback", () => {
    expect(display(null)).toBe("Keine Angabe");
    expect(display(undefined)).toBe("Keine Angabe");
    expect(display("")).toBe("Keine Angabe");
  });

  it("display returns value when present", () => {
    expect(display("Bayern")).toBe("Bayern");
    expect(display("✅")).toBe("✅");
  });

  it("isMissing detects nullish/empty", () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing("")).toBe(true);
    expect(isMissing("x")).toBe(false);
  });
});
