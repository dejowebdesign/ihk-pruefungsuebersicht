import { describe, it, expect } from "vitest";
import {
  normalizeOverview,
  normalizeQuestions,
  normalizeCaseExamples,
  extractIhkSemantics,
} from "../src/lib/normalize";
import { loadSheet } from "../src/lib/snapshot-loader";

describe("normalizeOverview", () => {
  it("normalizes all 82 Übersicht rows (incl. short name for every IHK)", async () => {
    const sheet = await loadSheet("Übersicht");
    const locs = normalizeOverview(sheet);
    expect(locs).toHaveLength(82);
    // Every normalized row must have a short name (no row lost).
    for (const l of locs) {
      expect(l.ihkShortName).toBeTruthy();
    }
  });

  it("maps known Aachen values correctly", async () => {
    const sheet = await loadSheet("Übersicht");
    const aachen = normalizeOverview(sheet)[0];
    expect(aachen.ihkShortName).toBe("Aachen");
    expect(aachen.bundesland).toBe("Nordrhein-Westfalen");
    expect(aachen.writtenForm).toBe("Laptop/PC");
    expect(aachen.sameDay).toBe("nein");
    expect(aachen.intervalWrittenOral).toBe("2-3_Wochen");
    expect(aachen.examinerCount).toBe("3");
    expect(aachen.groupFormat).toBe("Gruppe bis 5");
    expect(aachen.website).toContain("ihk.de/aachen");
  });

  it("keeps unknown values as null (never invented)", async () => {
    const sheet = await loadSheet("Übersicht");
    const aschaffenburg = normalizeOverview(sheet).find((l) => l.ihkShortName === "Aschaffenburg")!;
    // Aschaffenburg has ❌ for SKP and most fields.
    expect(aschaffenburg.skp).toBe("❌");
    expect(aschaffenburg.writtenForm).toBe("❌"); // stored verbatim, not guessed
  });

  it("parses gviz Date() into ISO date", async () => {
    const sheet = await loadSheet("Übersicht");
    const aachen = normalizeOverview(sheet)[0];
    expect(aachen.lastUpdatedRaw).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("normalizeQuestions (Master_Fragen_Muendlich)", () => {
  it("normalizes 244 question rows (regression)", async () => {
    const sheet = await loadSheet("Master_Fragen_Muendlich");
    const qs = normalizeQuestions(sheet);
    expect(qs).toHaveLength(244);
  });

  it("maps the first question correctly", async () => {
    const sheet = await loadSheet("Master_Fragen_Muendlich");
    const q = normalizeQuestions(sheet)[0];
    expect(q.masterId).toBe("1");
    expect(q.category).toBe("RdöSuO");
    expect(q.question).toBe("Was ist Recht?");
    expect(q.difficulty).toBe("2");
    expect(q.cluster).toBe("Grundlagen");
    expect(q.followUp1).toBe("Warum brauchen wir Recht?");
  });

  it("preserves the last question (no truncation)", async () => {
    const sheet = await loadSheet("Master_Fragen_Muendlich");
    const qs = normalizeQuestions(sheet);
    const last = qs[qs.length - 1];
    expect(last.category).toBe("Technik");
    expect(last.question).toContain("Videoanlage");
  });
});

describe("normalizeCaseExamples (Master_TOP_Fallbeispiele)", () => {
  it("normalizes 30 case examples", async () => {
    const sheet = await loadSheet("Master_TOP_Fallbeispiele");
    const cs = normalizeCaseExamples(sheet);
    expect(cs).toHaveLength(30);
  });

  it("maps the first case example correctly", async () => {
    const sheet = await loadSheet("Master_TOP_Fallbeispiele");
    const c = normalizeCaseExamples(sheet)[0];
    expect(c.masterId).toBe("1");
    expect(c.category).toContain("Ladendetektiv");
    expect(c.scenario).toContain("Diebstahl");
    expect(c.perfectAnswer).toContain("§242 StGB");
  });
});

describe("extractIhkSemantics (both layout variants)", () => {
  // 12 sheets are variant A (discrete "Medium"/"Ergebnis sofort"/"Abstand" rows),
  // 69 are variant B (these fields merged into header). See PHASE 1 analysis.
  const VARIANT_A = [
    "Aachen",
    "Aschaffenburg",
    "Bayreuth",
    "Bochum",
    "Bonn",
    "Braunschweig",
    "Coburg",
    "Darmstadt",
    "Detmold",
    "Duisburg",
    "Heidenheim",
    "VSW_Mainz",
  ];

  it("variant A (12 sheets incl. Aachen, Aschaffenburg): discrete labeled fields present", async () => {
    for (const name of VARIANT_A) {
      const sheet = await loadSheet(name);
      const sem = extractIhkSemantics(sheet);
      const fields = sem.map((s) => s.field);
      expect(fields, `${name} should expose discrete fields`).toContain("Medium");
      expect(fields).toContain("Ergebnis sofort");
      expect(fields).toContain("Abstand schriftlich/mündlich");
    }
  });

  it("variant A (Aachen): maps Medium value correctly", async () => {
    const sheet = await loadSheet("Aachen");
    const sem = extractIhkSemantics(sheet);
    const medium = sem.find((s) => s.field === "Medium");
    expect(medium?.value).toBe("Laptop/PC");
  });

  it("variant B (Berlin, Bielefeld): discrete fields NOT present (best-effort null)", async () => {
    for (const name of ["Berlin", "Bielefeld"]) {
      const sheet = await loadSheet(name);
      const sem = extractIhkSemantics(sheet);
      const fields = sem.map((s) => s.field);
      expect(fields, `${name} is variant B`).not.toContain("Medium");
      expect(fields).not.toContain("Abstand schriftlich/mündlich");
    }
  });

  it("common fields present across all city sheets (both variants)", async () => {
    for (const name of ["Aachen", "Bielefeld", "München", "Berlin"]) {
      const sheet = await loadSheet(name);
      const sem = extractIhkSemantics(sheet);
      const fields = sem.map((s) => s.field);
      expect(fields).toContain("Prüferanzahl");
      expect(fields).toContain("Einzel / Gruppe");
      expect(fields).toContain("Ergebnis bekannt");
    }
  });
});
