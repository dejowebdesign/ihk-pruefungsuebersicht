// Seed the oral-exam pool (themes + questions) from the Excel-derived JSON.
//
// Idempotent: matches by excelId/theme name, upserts, never deletes. Safe to
// run repeatedly. The public IHK `Question`/`CaseExample` tables are NOT
// touched — the oral pool is fully separate.

import { PrismaClient } from "@prisma/client";
import { ORAL_THEMES } from "./themes";
import seedRaw from "../../prisma/seed/oral-questions.json";

type SeedRow = {
  excelId: string;
  thema: string;
  nr?: number | null;
  quelle?: string | null;
  frage: string;
  erw?: string | null;
  geprueft?: string | null;
};

const seedRows = seedRaw as SeedRow[];

/** Upsert themes + questions for the oral exam pool. Returns counts. */
export async function seedOralPool(
  db: PrismaClient,
  rows: SeedRow[] = seedRows,
): Promise<{ themes: number; questions: number }> {
  // 1) Themes (8), keyed by name + orderKey.
  for (const t of ORAL_THEMES) {
    await db.oralTheme.upsert({
      where: { name: t.name },
      create: { orderKey: t.orderKey, name: t.name, weight: t.weight },
      update: { orderKey: t.orderKey, weight: t.weight },
    });
  }

  // 2) Questions, keyed by excelId.
  let questions = 0;
  for (const row of rows) {
    const theme = await db.oralTheme.findUnique({ where: { name: row.thema } });
    if (!theme) {
      throw new Error(`seed: unknown oral theme "${row.thema}" for ${row.excelId}`);
    }
    await db.oralQuestion.upsert({
      where: { excelId: row.excelId },
      create: {
        excelId: row.excelId,
        themeId: theme.id,
        nr: row.nr ?? null,
        source: row.quelle ?? null,
        question: row.frage,
        answer: row.erw ?? null,
        checked: row.geprueft ?? null,
      },
      update: {
        themeId: theme.id,
        nr: row.nr ?? null,
        source: row.quelle ?? null,
        question: row.frage,
        answer: row.erw ?? null,
        checked: row.geprueft ?? null,
      },
    });
    questions++;
  }

  return { themes: ORAL_THEMES.length, questions };
}
