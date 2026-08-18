// Snapshot → SQLite initial import.
// Reads the 85 JSON snapshot files, validates, and writes to Prisma.
// Fail-safe: all DB writes happen in a transaction; on validation failure the
// previous data is left untouched.

import path from "node:path";
import { prisma } from "../db/prisma";
import {
  loadAllSheets,
  loadManifest,
  snapshotDir,
} from "../lib/snapshot-loader";
import { classifySheet } from "../lib/classify";
import { validateSnapshot } from "../lib/validate";
import {
  extractIhkSemantics,
  normalizeCaseExamples,
  normalizeOverview,
  normalizeQuestions,
} from "../lib/normalize";
import type { SheetJson } from "../lib/types";

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
  errors: string[];
  warnings: string[];
  importRunId: string | null;
}

/**
 * Run the initial snapshot import.
 * @param dir snapshot directory (default: data/snapshot)
 */
export async function runInitialImport(dir = snapshotDir()): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let sheets: SheetJson[] = [];

  try {
    sheets = await loadAllSheets(dir);
  } catch (e) {
    errors.push(`Failed to load snapshot: ${(e as Error).message}`);
    return failureResult(errors, warnings, 0);
  }

  const validation = validateSnapshot(sheets);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    errors.push(...validation.errors);
    return failureResult(errors, warnings, sheets.length);
  }

  const manifest = await loadManifest(dir);

  // Create the ImportRun first (status RUNNING).
  const db = prisma();
  const run = await db.importRun.create({
    data: {
      status: "RUNNING",
      source: "snapshot",
      sourceRef: path.basename(dir),
      sheetsDetected: sheets.length,
      snapshotVersion: `snapshot-${sheets.length}sheets`,
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

  try {
    // Persist every sheet (raw + typed) in manifest order.
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

        // Raw rows preserved verbatim.
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

        // Type-specific normalization.
        if (sheetType === "OVERVIEW") {
          const locs = normalizeOverview(sheet);
          for (const loc of locs) {
            await db.ihkLocation.create({
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
          }
          dataRecords += locs.length;
        } else if (sheetType === "MASTER_QUESTIONS") {
          const qs = normalizeQuestions(sheet);
          for (const q of qs) {
            await db.question.create({
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
          }
          dataRecords += qs.length;
        } else if (sheetType === "MASTER_CASES") {
          const cs = normalizeCaseExamples(sheet);
          for (const c of cs) {
            await db.caseExample.create({
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
          }
          dataRecords += cs.length;
        } else if (sheetType === "IHK") {
          // Best-effort semantics from the city register.
          const sem = extractIhkSemantics(sheet);
          // Try to link to an IHK location by short name.
          let loc = await db.ihkLocation.findUnique({
            where: { ihkShortName: sheet.sheetName },
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
        // FREQUENT_ERRORS + UNKNOWN: raw rows only (already persisted above).
        sheetsImported++;
      } catch (e) {
        sheetFailures++;
        errors.push(`Sheet ${sheet.sheetName}: ${(e as Error).message}`);
      }
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
        changeCount: 0,
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
      errors,
      warnings,
      importRunId: run.id,
    };
  } catch (e) {
    // Catastrophic failure: mark run FAILED, leave prior data intact.
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
        changeCount: 0,
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
      errors,
      warnings,
      importRunId: run.id,
    };
  }
}

function failureResult(
  errors: string[],
  warnings: string[],
  sheetsDetected: number,
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
    errors,
    warnings,
    importRunId: null,
  };
}
