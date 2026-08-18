// Shared persistence + change detection for snapshot and live imports.
// Both sources produce SheetJson[] and go through the same persist path.
// Fail-safe: validation runs BEFORE any write; on failure, prior data is untouched.

import { prisma } from "../db/prisma";
import { classifySheet } from "../lib/classify";
import { validateSnapshot } from "../lib/validate";
import {
  extractIhkSemantics,
  normalizeCaseExamples,
  normalizeOverview,
  normalizeQuestions,
} from "../lib/normalize";
import type { SheetJson } from "../lib/types";
import type { PrismaClient } from "@prisma/client";

export interface ImportResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  sheetsDetected: number;
  sheetsImported: number;
  sheetFailures: number;
  dataRecords: number;
  ihkLocations: number;
  questions: number;
  caseExamples: number;
  rawRows: number;
  semantics: number;
  changeCount: number;
  errors: string[];
  warnings: string[];
  importRunId: string | null;
}

export type ImportSource = "snapshot" | "google-gviz";

export interface PersistOptions {
  source: ImportSource;
  sourceRef: string;
  snapshotVersion?: string;
  db?: PrismaClient; // injectable for tests
  skipChangeDetection?: boolean;
}

/** Validate + persist a batch of sheets (snapshot or live) into a new ImportRun. */
export async function persistImport(
  sheets: SheetJson[],
  opts: PersistOptions,
): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const validation = validateSnapshot(sheets);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    errors.push(...validation.errors);
    return failed(sheets.length, errors, warnings);
  }

  const db = opts.db ?? prisma();

  // Create the ImportRun (RUNNING). Change detection compares against the
  // PREVIOUS successful run's data, which still exists untouched.
  const previousRun = await db.importRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });

  const run = await db.importRun.create({
    data: {
      status: "RUNNING",
      source: opts.source,
      sourceRef: opts.sourceRef,
      sheetsDetected: sheets.length,
      snapshotVersion: opts.snapshotVersion ?? null,
    },
  });

  let sheetsImported = 0;
  let sheetFailures = 0;
  let dataRecords = 0;
  let ihkLocations = 0;
  let questions = 0;
  let caseExamples = 0;
  let rawRows = 0;
  let semantics = 0;
  let changeCount = 0;

  try {
    for (let order = 0; order < sheets.length; order++) {
      const sheet = sheets[order];
      const sheetType = classifySheet(sheet.sheetName);
      const headers = sheet.headers ?? [];
      try {
        const sheetRow = await db.sheet.create({
          data: {
            importRunId: run.id,
            gid: sheet.gid ?? "",
            originalName: sheet.sheetName,
            sheetType,
            orderIndex: order,
            rowCount: sheet.numRows ?? sheet.rows.length,
            colCount: sheet.numCols ?? headers.length,
            headers: JSON.stringify(headers),
            rawRowsJson: JSON.stringify(sheet.rows),
          },
        });

        for (let i = 0; i < sheet.rows.length; i++) {
          await db.ihkRawRow.create({
            data: {
              sheetId: sheetRow.id,
              rowIndex: i,
              rowJson: JSON.stringify(sheet.rows[i] ?? []),
            },
          });
          rawRows++;
        }

        if (sheetType === "OVERVIEW") {
          const locs = normalizeOverview(sheet);
          for (const loc of locs) {
            const created = await db.ihkLocation.create({
              data: {
                importRunId: run.id,
                sourceSheetId: sheetRow.id,
                sourceRowNumber: loc.sourceRowNumber,
                nr: loc.nr,
                ihkShortName: loc.ihkShortName,
                officialName: loc.officialName,
                skp: loc.skp,
                bundesland: loc.bundesland,
                writtenForm: loc.writtenForm,
                writtenResultImmediate: loc.writtenResultImmediate,
                sameDay: loc.sameDay,
                intervalWrittenOral: loc.intervalWrittenOral,
                examinerCount: loc.examinerCount,
                groupFormat: loc.groupFormat,
                fallbeispiel: loc.fallbeispiel,
                koFallbeispiel: loc.koFallbeispiel,
                punktesystem: loc.punktesystem,
                vorbereitung: loc.vorbereitung,
                notizen: loc.notizen,
                dataState: loc.dataState,
                lastUpdatedRaw: loc.lastUpdatedRaw,
                bezirk: loc.bezirk,
                adresse: loc.adresse,
                telefon: loc.telefon,
                website: loc.website,
                ansprechpartner: loc.ansprechpartner,
                durchwahl: loc.durchwahl,
                email: loc.email,
                routeUrl: loc.routeUrl,
              },
            });
            ihkLocations++;
            if (!opts.skipChangeDetection && previousRun) {
              changeCount += await detectIhkLocationChanges(
                db,
                run.id,
                previousRun.id,
                loc,
                created.id,
              );
            }
          }
          dataRecords += locs.length;
        } else if (sheetType === "MASTER_QUESTIONS") {
          const qs = normalizeQuestions(sheet);
          for (const q of qs) {
            const created = await db.question.create({
              data: {
                importRunId: run.id,
                sourceSheetId: sheetRow.id,
                sourceRowNumber: q.sourceRowNumber,
                masterId: q.masterId,
                category: q.category,
                question: q.question,
                answer: q.answer,
                legalBasis: q.legalBasis,
                difficulty: q.difficulty,
                cluster: q.cluster,
                followUp1: q.followUp1,
                followUp2: q.followUp2,
                extraCol: q.extraCol,
              },
            });
            questions++;
            if (!opts.skipChangeDetection && previousRun) {
              changeCount += await detectQuestionChanges(
                db,
                run.id,
                previousRun.id,
                q,
                created.id,
              );
            }
          }
          dataRecords += qs.length;
        } else if (sheetType === "MASTER_CASES") {
          const cs = normalizeCaseExamples(sheet);
          for (const c of cs) {
            const created = await db.caseExample.create({
              data: {
                importRunId: run.id,
                sourceSheetId: sheetRow.id,
                sourceRowNumber: c.sourceRowNumber,
                masterId: c.masterId,
                category: c.category,
                scenario: c.scenario,
                perfectAnswer: c.perfectAnswer,
                legalBasis: c.legalBasis,
                difficulty: c.difficulty,
                cluster: c.cluster,
                followUp1: c.followUp1,
                answer1: c.answer1,
                followUp2: c.followUp2,
                answer2: c.answer2,
              },
            });
            caseExamples++;
            if (!opts.skipChangeDetection && previousRun) {
              changeCount += await detectCaseExampleChanges(
                db,
                run.id,
                previousRun.id,
                c,
                created.id,
              );
            }
          }
          dataRecords += cs.length;
        } else if (sheetType === "IHK") {
          const sem = extractIhkSemantics(sheet);
          // Link semantics to the IHK location created in THIS run (by short name).
          let loc = await db.ihkLocation.findFirst({
            where: { importRunId: run.id, ihkShortName: sheet.sheetName },
          });
          for (const s of sem) {
            await db.ihkSemantics.create({
              data: {
                sheetId: sheetRow.id,
                ihkLocationId: loc?.id ?? null,
                field: s.field,
                value: s.value,
                sourceRowNumber: s.sourceRowNumber,
              },
            });
            semantics++;
          }
          dataRecords += sem.length;
        }
        sheetsImported++;
      } catch (e) {
        sheetFailures++;
        errors.push(`Sheet ${sheet.sheetName}: ${(e as Error).message}`);
      }
    }

    // Detect added/removed IHKs (by short name) against the previous run.
    if (!opts.skipChangeDetection && previousRun) {
      changeCount += await detectAddedRemovedIhks(db, run.id, previousRun.id);
    }

    const status =
      sheetFailures === 0 ? "SUCCESS" : sheetFailures < sheets.length ? "PARTIAL" : "FAILED";

    await db.importRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        sheetsImported,
        sheetFailures,
        dataRecords,
        ihkLocations,
        questions,
        caseExamples,
        changeCount,
        errors: errors.length ? errors.join("\n") : null,
      },
    });

    return {
      status,
      sheetsDetected: sheets.length,
      sheetsImported,
      sheetFailures,
      dataRecords,
      ihkLocations,
      questions,
      caseExamples,
      rawRows,
      semantics,
      changeCount,
      errors,
      warnings,
      importRunId: run.id,
    };
  } catch (e) {
    errors.push(`Fatal import error: ${(e as Error).message}`);
    await db.importRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        sheetsImported,
        sheetFailures,
        dataRecords,
        ihkLocations,
        questions,
        caseExamples,
        changeCount,
        errors: errors.join("\n"),
      },
    });
    return {
      status: "FAILED",
      sheetsDetected: sheets.length,
      sheetsImported,
      sheetFailures,
      dataRecords,
      ihkLocations,
      questions,
      caseExamples,
      rawRows,
      semantics,
      changeCount,
      errors,
      warnings,
      importRunId: run.id,
    };
  }
}

function failed(
  sheetsDetected: number,
  errors: string[],
  warnings: string[],
): ImportResult {
  return {
    status: "FAILED",
    sheetsDetected,
    sheetsImported: 0,
    sheetFailures: 0,
    dataRecords: 0,
    ihkLocations: 0,
    questions: 0,
    caseExamples: 0,
    rawRows: 0,
    semantics: 0,
    changeCount: 0,
    errors,
    warnings,
    importRunId: null,
  };
}

// ─── Change detection helpers ───────────────────────────────────────────────

const IHK_LOCATION_FIELDS = [
  "officialName",
  "skp",
  "bundesland",
  "writtenForm",
  "writtenResultImmediate",
  "sameDay",
  "intervalWrittenOral",
  "examinerCount",
  "groupFormat",
  "fallbeispiel",
  "koFallbeispiel",
  "punktesystem",
  "vorbereitung",
  "notizen",
  "dataState",
  "lastUpdatedRaw",
  "bezirk",
  "adresse",
  "telefon",
  "website",
  "ansprechpartner",
  "durchwahl",
  "email",
  "routeUrl",
] as const;

async function detectIhkLocationChanges(
  db: PrismaClient,
  runId: string,
  prevRunId: string,
  loc: ReturnType<typeof normalizeOverview>[number],
  newId: string,
): Promise<number> {
  const prev = await db.ihkLocation.findFirst({
    where: { importRunId: prevRunId, ihkShortName: loc.ihkShortName },
  });
  if (!prev) return 0; // new IHK handled centrally (detectAddedRemovedIhks)
  let count = 0;
  for (const field of IHK_LOCATION_FIELDS) {
    const oldVal = prev[field] ?? null;
    const newVal = (loc as unknown as Record<string, unknown>)[field] ?? null;
    const oldStr = oldVal === null ? null : String(oldVal);
    const newStr = newVal === null ? null : String(newVal);
    if (oldStr !== newStr) {
      await db.changeRecord.create({
        data: {
          importRunId: runId,
          entityType: "IhkLocation",
          entityId: newId,
          sheetName: "Übersicht",
          rowId: String(loc.sourceRowNumber),
          field,
          oldValue: oldStr,
          newValue: newStr,
          ihkLocationId: newId,
        },
      });
      count++;
    }
  }
  return count;
}

const QUESTION_FIELDS = [
  "category",
  "question",
  "answer",
  "legalBasis",
  "difficulty",
  "cluster",
  "followUp1",
  "followUp2",
  "extraCol",
] as const;

async function detectQuestionChanges(
  db: PrismaClient,
  runId: string,
  prevRunId: string,
  q: ReturnType<typeof normalizeQuestions>[number],
  newId: string,
): Promise<number> {
  const prev = await db.question.findFirst({
    where: { importRunId: prevRunId, sourceRowNumber: q.sourceRowNumber },
  });
  if (!prev) return 0; // new question (not yet tracked centrally)
  let count = 0;
  for (const field of QUESTION_FIELDS) {
    const oldVal = prev[field] ?? null;
    const newVal = (q as unknown as Record<string, unknown>)[field] ?? null;
    const oldStr = oldVal === null ? null : String(oldVal);
    const newStr = newVal === null ? null : String(newVal);
    if (oldStr !== newStr) {
      await db.changeRecord.create({
        data: {
          importRunId: runId,
          entityType: "Question",
          entityId: newId,
          sheetName: "Master_Fragen_Muendlich",
          rowId: String(q.sourceRowNumber),
          field,
          oldValue: oldStr,
          newValue: newStr,
          questionId: newId,
        },
      });
      count++;
    }
  }
  return count;
}

const CASE_FIELDS = [
  "category",
  "scenario",
  "perfectAnswer",
  "legalBasis",
  "difficulty",
  "cluster",
  "followUp1",
  "answer1",
  "followUp2",
  "answer2",
] as const;

async function detectCaseExampleChanges(
  db: PrismaClient,
  runId: string,
  prevRunId: string,
  c: ReturnType<typeof normalizeCaseExamples>[number],
  newId: string,
): Promise<number> {
  const prev = await db.caseExample.findFirst({
    where: { importRunId: prevRunId, sourceRowNumber: c.sourceRowNumber },
  });
  if (!prev) return 0;
  let count = 0;
  for (const field of CASE_FIELDS) {
    const oldVal = prev[field] ?? null;
    const newVal = (c as unknown as Record<string, unknown>)[field] ?? null;
    const oldStr = oldVal === null ? null : String(oldVal);
    const newStr = newVal === null ? null : String(newVal);
    if (oldStr !== newStr) {
      await db.changeRecord.create({
        data: {
          importRunId: runId,
          entityType: "CaseExample",
          entityId: newId,
          sheetName: "Master_TOP_Fallbeispiele",
          rowId: String(c.sourceRowNumber),
          field,
          oldValue: oldStr,
          newValue: newStr,
          caseExampleId: newId,
        },
      });
      count++;
    }
  }
  return count;
}

/** Detect IHKs that were added or removed (by short name) between runs. */
async function detectAddedRemovedIhks(
  db: PrismaClient,
  runId: string,
  prevRunId: string,
): Promise<number> {
  const prevNames = (
    await db.ihkLocation.findMany({
      where: { importRunId: prevRunId },
      select: { ihkShortName: true },
    })
  ).map((l) => l.ihkShortName);
  const newNames = (
    await db.ihkLocation.findMany({
      where: { importRunId: runId },
      select: { ihkShortName: true, id: true },
    })
  );
  const newSet = new Map(newNames.map((l) => [l.ihkShortName, l.id]));
  const prevSet = new Set(prevNames);
  let count = 0;
  // Added IHKs
  for (const [name, id] of newSet) {
    if (!prevSet.has(name)) {
      await db.changeRecord.create({
        data: {
          importRunId: runId,
          entityType: "IhkLocation",
          entityId: id,
          sheetName: "Übersicht",
          field: "__added__",
          oldValue: null,
          newValue: name,
          ihkLocationId: id,
        },
      });
      count++;
    }
  }
  // Removed IHKs (entity no longer exists; record by name only)
  const newLookup = new Set(newSet.keys());
  for (const name of prevNames) {
    if (!newLookup.has(name)) {
      await db.changeRecord.create({
        data: {
          importRunId: runId,
          entityType: "IhkLocation",
          entityId: name,
          sheetName: "Übersicht",
          field: "__removed__",
          oldValue: name,
          newValue: null,
        },
      });
      count++;
    }
  }
  return count;
}
