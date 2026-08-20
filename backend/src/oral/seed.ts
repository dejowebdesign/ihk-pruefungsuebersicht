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

/**
 * Startup self-bootstrap for the oral question pool.
 *
 * Why this exists: a fresh production/Docker deploy starts from an empty
 * SQLite volume. `docker-entrypoint.sh` runs `prisma db push` (creates the
 * tables) but nothing populates them, so `createExam` throws
 * "oral question pool is empty — run seed first". The oral pool is reference
 * data baked into the image (oral-questions.json) — distinct from the live
 * IHK import bootstrapped by `maybeInitialImport` — so it must be seeded
 * independently and automatically.
 *
 * Idempotent & restart-safe:
 *   - Counts OralQuestion; runs the upsert pass ONLY when the pool is empty
 *     (or partially seeded). A fully-populated pool short-circuits after one
 *     COUNT — repeated container restarts are free.
 *   - `seedOralPool` upserts by unique `excelId`/`name`, so even a partial pool
 *     can never produce duplicates or overwrite an exam's referenced question
 *     row (the row's `id` is preserved by upsert).
 *   - OralExam/OralExamQuestion/OralCandidate are never touched here, so
 *     existing exams, ratings and scores are immutable across restarts.
 *
 * Mirrors the `maybeInitialImport` philosophy: safe to call on every start,
 * defers to the next start on failure rather than crashing the server.
 */
export async function ensureOralPoolSeeded(
  db: PrismaClient,
): Promise<{ themes: number; questions: number; seeded: boolean }> {
  let existing = 0;
  try {
    existing = await db.oralQuestion.count();
  } catch {
    // Schema not pushed yet (entrypoint racing db push) or DB unreachable.
    // Defer to the next start rather than crashing — matches maybeInitialImport.
    return { themes: 0, questions: 0, seeded: false };
  }
  // Full pool already present: nothing to do. Partial pool (< seedRows.length):
  // run the upsert pass to fill gaps without duplicating existing rows.
  if (existing >= seedRows.length) {
    return { themes: ORAL_THEMES.length, questions: existing, seeded: false };
  }
  const res = await seedOralPool(db);
  return { ...res, seeded: true };
}
