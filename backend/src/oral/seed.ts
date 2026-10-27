// Seed the oral-exam pool (themes + questions) from the Excel-derived JSON.
//
// Idempotent: matches by excelId/theme name, upserts, never deletes. Safe to
// run repeatedly. The public IHK `Question`/`CaseExample` tables are NOT
// touched — the oral pool is fully separate.

import { createHash } from "node:crypto";
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

/** Stable content fingerprint of the shipped seed file (for logging/diagnostics). */
export function seedFingerprint(rows: SeedRow[] = seedRows): string {
  const h = createHash("sha256");
  for (const r of rows) h.update(`${r.excelId}\u0000${r.frage}\u0000${r.erw ?? ""}\u0000${r.thema}\n`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Does the stored pool already match the shipped seed file, field for field?
 *
 * Content comparison (not a row count) is what makes text corrections land on
 * an already-populated production DB: `ensureOralPoolSeeded` used to skip as
 * soon as `count() >= seedRows.length`, so a corrected question text in the
 * JSON never reached a database that already had all 341 rows.
 */
async function poolMatchesSeed(db: PrismaClient): Promise<boolean> {
  const stored = await db.oralQuestion.findMany({
    select: { excelId: true, question: true, answer: true, nr: true, source: true },
  });
  if (stored.length !== seedRows.length) return false;
  const byId = new Map(stored.map((r) => [r.excelId, r]));
  for (const s of seedRows) {
    const r = byId.get(s.excelId);
    if (!r) return false;
    if (r.question !== s.frage) return false;
    if ((r.answer ?? null) !== (s.erw ?? null)) return false;
  }
  return true;
}

/** Upsert themes + questions for the oral exam pool. Returns counts. */
export async function seedOralPool(
  db: PrismaClient,
  rows: SeedRow[] = seedRows,
): Promise<{ themes: number; questions: number }> {
  // 1) Themes, keyed by name + orderKey.
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
 *   - Compares the STORED pool against the shipped seed file field for field.
 *     A fully up-to-date pool short-circuits (one query); a pool that is
 *     missing rows *or* carries outdated question/answer text triggers the
 *     upsert pass, so text corrections reach an already-populated database.
 *   - `seedOralPool` upserts by unique `excelId`/`name`, so the correction run
 *     can never duplicate rows, delete rows, or change a question's `id` —
 *     historical exams keep pointing at the same question rows.
 *   - OralExam/OralExamQuestion/OralCandidate are never touched here, so
 *     existing exams, ratings, points, weights and results are immutable
 *     across restarts and across a correction run.
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
  if (existing > 0 && (await poolMatchesSeed(db))) {
    return { themes: ORAL_THEMES.length, questions: existing, seeded: false };
  }
  const res = await seedOralPool(db);
  return { ...res, seeded: true };
}
