import { describe, it, expect } from "vitest";
import { classifySheet, CRITICAL_SHEETS } from "../src/lib/classify";

describe("classify", () => {
  it("classifies the 4 critical sheets correctly", () => {
    expect(classifySheet("Übersicht")).toBe("OVERVIEW");
    expect(classifySheet("Master_Fragen_Muendlich")).toBe("MASTER_QUESTIONS");
    expect(classifySheet("Master_TOP_Fallbeispiele")).toBe("MASTER_CASES");
    expect(classifySheet("Häufige_Fehler")).toBe("FREQUENT_ERRORS");
  });

  it("classifies city IHK registers as IHK", () => {
    expect(classifySheet("Aachen")).toBe("IHK");
    expect(classifySheet("Berlin")).toBe("IHK");
    expect(classifySheet("München")).toBe("IHK");
    expect(classifySheet("VSW_Mainz")).toBe("IHK");
    expect(classifySheet("Frankfurt.Oder")).toBe("IHK");
  });

  it("lists all 4 critical sheet names", () => {
    expect(CRITICAL_SHEETS).toHaveLength(4);
    expect(CRITICAL_SHEETS).toContain("Übersicht");
  });
});
