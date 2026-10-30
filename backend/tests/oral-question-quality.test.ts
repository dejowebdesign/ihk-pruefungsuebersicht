// Quality gate for the oral question pool (backend/prisma/seed/oral-questions.json)
// plus the correction-run path that makes edited question text reach a database
// that is already fully populated.
//
// Scope note: these checks assert *textual* integrity — no empty fields, no
// control/replacement characters, no leaked document headers/footers, no
// OCR letter-substitution artefacts, unique ids, valid theme mapping and
// non-empty answers. They deliberately do NOT claim that any answer is
// legally correct; that is what `docs/oral-question-quality-audit.md` records
// per entry, with the entries still open marked as such.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import { seedOralPool, ensureOralPoolSeeded, seedFingerprint } from "../src/oral/seed";
import { ORAL_THEMES, ORAL_QUESTIONS_PER_EXAM, ORAL_TOTAL_WEIGHT } from "../src/oral/themes";
import seedRaw from "../prisma/seed/oral-questions.json";

type SeedRow = {
  excelId: string;
  thema: string;
  nr: number | null;
  quelle: string | null;
  frage: string;
  erw: string | null;
  geprueft: string | null;
};

const rows = seedRaw as SeedRow[];
const byId = new Map(rows.map((r) => [r.excelId, r]));
const textOf = (r: SeedRow) => `${r.frage}\n${r.erw ?? ""}`;

/** theme name -> id prefix used by this pool */
const THEME_PREFIX: Record<string, string> = {
  "Recht der oeffentlichen Sicherheit und Ordnung": "RdOesO",
  "Gewerberecht / Bewachungsverordnung": "Gewerberecht",
  "Buergerliches Gesetzbuch / Jedermannsrechte": "BGB",
  "Straf- und Verfahrensrecht": "StGB",
  "Umgang mit Waffen": "UmW",
  "Umgang mit Menschen / Deeskalation": "UmM",
  Datenschutzrecht: "Datenschutz",
  "Grundlagen der Sicherheitstechnik": "Sicherheitstechnik",
  Unfallverhuetungsvorschriften: "UVV",
};

describe("oral question pool — seed file integrity", () => {
  it("has exactly one entry per excelId", () => {
    const ids = rows.map((r) => r.excelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty question or answer", () => {
    const empty = rows.filter((r) => !r.frage.trim() || !(r.erw ?? "").trim()).map((r) => r.excelId);
    expect(empty).toEqual([]);
  });

  it("contains no control, replacement or zero-width characters", () => {
    const bad: string[] = [];
    for (const r of rows) {
      for (const [field, value] of Object.entries({ frage: r.frage, erw: r.erw ?? "" })) {
        for (const ch of value) {
          const c = ch.codePointAt(0)!;
          const isControl = c < 0x20 && ch !== "\n" && ch !== "\t";
          if (isControl || c === 0xfffd || c === 0xfeff || c === 0x200b) {
            bad.push(`${r.excelId}.${field}: U+${c.toString(16).toUpperCase().padStart(4, "0")}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaks no document headers, footers, author or date stamps into the text", () => {
    const patterns = [
      /Prüfungsfragen/i,
      /DBA\s+Marcel/i,
      /Dezember\s+2025/i,
      /\.pdf/i,
      /\.xlsx/i,
      /Fragen\.txt/i,
      /\bSeite\s*\d+/i,
      /\bStand:?\s*\d{2}[./]\d{2}/i,
    ];
    const leaks: string[] = [];
    for (const r of rows) {
      for (const p of patterns) {
        if (p.test(textOf(r))) leaks.push(`${r.excelId}: ${p}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("contains no OCR letter-substitution artefacts (ff was read as 2/6/K/O/X/c)", () => {
    // Word-level allow-list: only tokens that are wrong in this pool.
    const artefacts = [
      "Schusswa2en", "Schusswa6e", "Schusswa6en", "Feuerwa2en", "Feuerwa6e",
      "Kriegswa6en", "Luftdruckwa6en", "Reizstoffwa6en", "Signalwa6e", "Signalwa6en",
      "Stoßwa6en", "Anscheinswa2en", "Anscheinswa6en", "Schreckschusswa6e",
      "Schreckschusswa6en", "bewa6neten", "Pfe6erspray", "Wa6G", "WaKG",
      "Gri2stück", "Handgri2en", "zugri2sbereit", "zugri6sbereit", "Angri6",
      "Angribspunkt", "SchaKen", "geschaKen", "StoKe", "WaOen", "WaOe",
      "AuOorderung", "EingriX", "OOizialdelikte", "ö2entlichen", "öKentliches",
      "Öcentliche", "Panikbegrice", "Selbstocenbarung", "Ecekt", "Obene",
      "Komprissbereitschaft", "aggressionsbereiter", "verschienenen", "tribt",
      "treben", "Überlebensinstinke", "Vorraussetzungen",
    ];
    const found: string[] = [];
    for (const r of rows) {
      const t = textOf(r);
      for (const a of artefacts) {
        // word boundary: "treben" must not match inside "widerstrebende"
        const re = new RegExp(`(?<![\\w])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`);
        if (re.test(t)) found.push(`${r.excelId}: ${a}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("has no dangling source-name fragment at the end of a field", () => {
    const dangling = /(?:Umgang mit(?: Menschen)?|RdöSO|Gewerberecht|Datenschutz|Sicherheitstechnik)\s*$/;
    const found: string[] = [];
    for (const r of rows) {
      if (dangling.test(r.frage)) found.push(`${r.excelId}.frage`);
      if (dangling.test(r.erw ?? "")) found.push(`${r.excelId}.erw`);
    }
    expect(found).toEqual([]);
  });

  it("maps every entry to a known theme, matching its excelId prefix", () => {
    const themeNames = new Set(ORAL_THEMES.map((t) => t.name));
    const problems: string[] = [];
    for (const r of rows) {
      if (!themeNames.has(r.thema)) problems.push(`${r.excelId}: unknown theme ${r.thema}`);
      const prefix = r.excelId.replace(/-[^-]+$/, "");
      const expected = THEME_PREFIX[r.thema];
      if (expected && prefix !== expected) {
        problems.push(`${r.excelId}: theme ${r.thema} expects prefix ${expected}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps nr unique within a theme and keeps the UVV ids intact", () => {
    const perTheme = new Map<string, number[]>();
    for (const r of rows) {
      if (r.nr === null) continue;
      const list = perTheme.get(r.thema) ?? [];
      list.push(r.nr);
      perTheme.set(r.thema, list);
    }
    for (const [theme, nrs] of perTheme) {
      expect(new Set(nrs).size, `duplicate nr in ${theme}`).toBe(nrs.length);
    }
    const uvv = rows.filter((r) => r.thema === "Unfallverhuetungsvorschriften");
    expect(uvv.map((r) => r.excelId)).toEqual([
      "UVV-01", "UVV-02", "UVV-03", "UVV-04", "UVV-05", "UVV-06",
      "UVV-07", "UVV-08", "UVV-09", "UVV-10", "UVV-11",
    ]);
  });

  it("keeps a stable content fingerprint so unintended edits are visible", () => {
    // Guards against a silent bulk rewrite: any change to the pool text must
    // come with a deliberate update of this hash.
    expect(seedFingerprint(rows)).toBe("33551966b57f8232");
  });
});

describe("previously defective records stay fixed", () => {
  const cases: Array<[string, (r: SeedRow) => void]> = [
    // [excelId, assertion] — one per defect class found in the audit.
    ["UmW-03", (r) => expect(r.erw).toMatch(/Schusswaffen sind die Oberkategorie/)],
    ["UmW-04", (r) => expect(r.frage).toBe("Was ist der Unterschied zwischen einer Schusswaffe und einer Feuerwaffe?")],
    ["RdOesO-04", (r) => {
      expect(r.frage).toBe("Erklären Sie den Begriff horizontale Gewaltenteilung.");
      expect(r.erw).toMatch(/Legislative/);
      expect(r.frage).not.toMatch(/Legislative/);
    }],
    ["UmM-05", (r) => {
      expect(r.frage).toBe("Beschreibe das Johari Fenster.");
      expect(r.erw).toMatch(/Johari-Fenster/);
      expect(r.frage).not.toMatch(/visualisiert/);
    }],
    ["Sicherheitstechnik-34", (r) => {
      expect(r.frage).toBe("Wie lösche ich die Brandklassen?");
      expect(r.erw).toMatch(/ABC-Pulverlöscher/);
    }],
    ["Sicherheitstechnik-02", (r) => expect(r.frage).toBe("Was ist die Widerstandszeit?")],
    ["UmW-02", (r) => expect(r.frage).toBe("Was sind Waffen im Sinne des Waffengesetzes?")],
    ["BGB-02", (r) => expect(r.frage).not.toMatch(/brechen/)],
    ["StGB-01", (r) => {
      expect(r.frage).toBe("Wie teilt sich das Strafgesetzbuch auf?");
      expect(r.erw).toBe("a. Allgemeiner Teil b. Besonderer Teil");
    }],
    ["RdOesO-14", (r) => {
      expect(r.erw).not.toMatch(/Welche Aufgabe hat die Polizei/);
      expect(r.erw).toMatch(/Rechtsstaat|staatliches Handeln/);
    }],
    ["RdOesO-15", (r) => {
      expect(r.frage).toBe("Welche Aufgabe hat die Polizei?");
      expect(r.erw).toMatch(/Gefahrenabwehr/);
      expect(r.nr).toBe(15);
    }],
    ["UmM-16", (r) => {
      expect(r.erw).toMatch(/Offene Fragen/);
      expect(r.erw).not.toMatch(/Obene/);
    }],
    ["UmM-18", (r) => expect(r.frage).toBe("Was ist der Halo Effekt?")],
    ["UmM-35", (r) => expect(r.frage).toBe("Welche Panikbegriffe gibt es?")],
    ["UmM-37", (r) => expect(r.erw).toMatch(/Angriffspunkt/)],
    ["UmM-01", (r) => expect(r.erw).toMatch(/die sich mit dem Leben/)],
    ["StGB-22", (r) => expect(r.frage).toMatch(/\(§123 StGB\)\?/)],
    ["StGB-12", (r) => expect(r.frage).toMatch(/\?$/)],
    ["BGB-11", (r) => expect(r.erw).not.toMatch(/Handlung nach$/)],
  ];

  for (const [id, assert] of cases) {
    it(`${id} is corrected`, () => {
      const r = byId.get(id);
      expect(r, `${id} missing from the pool`).toBeTruthy();
      assert(r!);
    });
  }
});

describe("seed file matches the database after a correction run", () => {
  let dbPath: string;
  let client: PrismaClient;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `ihk-oral-quality-${Date.now()}.db`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    process.env.DATABASE_URL = `file:${dbPath}`;
    execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "ignore",
      env: { ...process.env },
    });
    client = new PrismaClient();
    setPrismaClient(client);
  });

  afterAll(async () => {
    await disconnectPrisma();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("writes the corrected text into the database, not just the JSON", async () => {
    await seedOralPool(client);
    for (const id of ["UmW-03", "UmM-35", "RdOesO-04", "RdOesO-15", "Sicherheitstechnik-34"]) {
      const stored = await client.oralQuestion.findUnique({ where: { excelId: id } });
      expect(stored, `${id} not seeded`).toBeTruthy();
      expect(stored!.question).toBe(byId.get(id)!.frage);
      expect(stored!.answer ?? null).toBe(byId.get(id)!.erw ?? null);
    }
  });

  it("re-applies corrections to a database that is already fully populated", async () => {
    // Reproduce the production situation the old count-based guard missed:
    // the row count is already complete, but one question text is stale.
    const stale = await client.oralQuestion.findUnique({ where: { excelId: "UmM-35" } });
    await client.oralQuestion.update({
      where: { excelId: "UmM-35" },
      data: { question: "Welche Panikbegrice gibt es?" },
    });

    const res = await ensureOralPoolSeeded(client);
    expect(res.seeded).toBe(true); // count was unchanged, content was not

    const after = await client.oralQuestion.findUnique({ where: { excelId: "UmM-35" } });
    expect(after!.question).toBe("Welche Panikbegriffe gibt es?");
    expect(after!.id).toBe(stale!.id); // same row: historical exams keep working
    expect(await client.oralQuestion.count()).toBe(rows.length);
  });

  it("is a no-op once the stored pool matches the seed file", async () => {
    const res = await ensureOralPoolSeeded(client);
    expect(res.seeded).toBe(false);
    expect(await client.oralQuestion.count()).toBe(rows.length);
    const all = await client.oralQuestion.findMany({ select: { excelId: true } });
    expect(new Set(all.map((q) => q.excelId)).size).toBe(all.length);
  });

  it("never deletes or rewrites the themes", async () => {
    const themes = await client.oralTheme.findMany({ orderBy: { orderKey: "asc" } });
    expect(themes.map((t) => t.name)).toEqual(ORAL_THEMES.map((t) => t.name));
    expect(themes.map((t) => t.weight)).toEqual(ORAL_THEMES.map((t) => t.weight));
  });

  it("a correction run leaves a historical exam and its ratings untouched", async () => {
    const { createExam, rateQuestion, completeExam } = await import("../src/oral/service");
    const { examId } = await createExam(client, { candidateName: "Audit-Bestand" });
    const items = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    // 13 questions across 8 themes, 4 main themes x2, <=2 per theme
    expect(items).toHaveLength(ORAL_QUESTIONS_PER_EXAM);
    expect(new Set(items.map((i) => i.themeName)).size).toBe(8);
    const perTheme = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.themeName] = (acc[i.themeName] ?? 0) + 1;
      return acc;
    }, {});
    for (const n of Object.values(perTheme)) expect(n).toBeLessThanOrEqual(2);

    // rate everything "richtig" and finalize
    for (const it of items) {
      await rateQuestion(client, examId, it.orderKey, { rating: "richtig" });
    }
    await completeExam(client, examId);
    const before = await client.oralExam.findUnique({ where: { id: examId } });
    expect(before!.percent).toBe(ORAL_TOTAL_WEIGHT);
    expect(before!.result).toBe("Bestanden");
    const ratingsBefore = items.map((i) => `${i.orderKey}:${i.questionId}`);

    // force a correction run by making the stored pool look stale
    await client.oralQuestion.update({
      where: { excelId: "UmM-35" },
      data: { question: "Welche Panikbegrice gibt es?" },
    });
    expect((await ensureOralPoolSeeded(client)).seeded).toBe(true);

    const after = await client.oralExam.findUnique({ where: { id: examId } });
    expect(after!.percent).toBe(before!.percent);
    expect(after!.result).toBe(before!.result);
    expect(after!.status).toBe("completed");
    const itemsAfter = await client.oralExamQuestion.findMany({
      where: { examId },
      orderBy: { orderKey: "asc" },
    });
    expect(itemsAfter.map((i) => `${i.orderKey}:${i.questionId}`)).toEqual(ratingsBefore);
    expect(itemsAfter.every((i) => i.rating === "richtig")).toBe(true);
    // The percentage model derives everything from the rating; the legacy
    // points column stays 0 for percent exams.
    for (const i of itemsAfter) expect(i.points).toBe(0);
  });
});
