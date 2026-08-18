// Configurable import scheduler with a mutex against parallel imports.
// Default: every 6 hours (IMPORT_INTERVAL_HOURS env var).

import { runLiveImport } from "../importer/live-import";
import { prisma } from "../db/prisma";
import type { ImportResult } from "../importer/persist";

const DEFAULT_INTERVAL_HOURS = 6;

let intervalHandle: NodeJS.Timeout | null = null;
let importInProgress = false;

export function importIntervalHours(): number {
  const raw = process.env.IMPORT_INTERVAL_HOURS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

/** True if an import is currently running (used by tests and the mutex). */
export function isImportRunning(): boolean {
  return importInProgress;
}

/**
 * Trigger a single import, guarded by a mutex. If an import is already running,
 * returns immediately with `skipped: true` — never starts a second parallel run.
 */
export async function triggerImport(): Promise<ImportResult | { skipped: true; reason: string }> {
  if (importInProgress) {
    return { skipped: true, reason: "import already running" };
  }
  importInProgress = true;
  try {
    return await runLiveImport();
  } finally {
    importInProgress = false;
  }
}

/** Start the periodic scheduler. Returns the interval handle (for shutdown). */
export function startScheduler(): NodeJS.Timeout {
  if (intervalHandle) {
    return intervalHandle;
  }
  const hours = importIntervalHours();
  const ms = hours * 60 * 60 * 1000;
  intervalHandle = setInterval(async () => {
    try {
      await triggerImport();
    } catch (e) {
      console.error("Scheduled import failed:", e);
    }
  }, ms);
  if (intervalHandle.unref) intervalHandle.unref();
  console.log(`Import scheduler started: every ${hours}h`);
  return intervalHandle;
}

/** Stop the periodic scheduler. */
export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("Import scheduler stopped");
  }
}

/**
 * Bootstrap: after a fresh deployment the database has no successful ImportRun,
 * so all public read endpoints return 503 ("no data available yet") and would
 * stay that way until the first 6h tick. To make a fresh deploy self-populate,
 * trigger one import now when (and only when) no SUCCESS run exists yet.
 *
 * Fire-and-forget from the server entrypoint: the HTTP server starts immediately
 * and data becomes available once this background import completes. Guarded by
 * the same mutex as scheduled/admin imports, so it never races the scheduler.
 * Retries naturally on the next start / next tick if it fails.
 */
export async function maybeInitialImport(): Promise<
  ImportResult | { skipped: true; reason: string } | null
> {
  try {
    const db = prisma();
    const lastSuccess = await db.importRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
    });
    if (lastSuccess) {
      return { skipped: true, reason: "data already present" };
    }
  } catch (e) {
    // If the schema isn't pushed yet (e.g. entrypoint racing db push) or the DB
    // is unreachable, defer to the scheduled tick rather than crashing startup.
    console.error("Initial import availability check failed:", e);
    return null;
  }
  console.log("No prior successful import — starting initial bootstrap import...");
  return triggerImport();
}

/** Report current scheduler state (last success / last attempt / next run). */
export async function schedulerStatus() {
  const db = prisma();
  const lastSuccess = await db.importRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
  const lastAttempt = await db.importRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  return {
    running: importInProgress,
    intervalHours: importIntervalHours(),
    lastSuccess: lastSuccess
      ? {
          id: lastSuccess.id,
          startedAt: lastSuccess.startedAt,
          finishedAt: lastSuccess.finishedAt,
          sheetsImported: lastSuccess.sheetsImported,
          changeCount: lastSuccess.changeCount,
        }
      : null,
    lastAttempt: lastAttempt
      ? {
          id: lastAttempt.id,
          status: lastAttempt.status,
          startedAt: lastAttempt.startedAt,
          finishedAt: lastAttempt.finishedAt,
          error: lastAttempt.errors,
        }
      : null,
  };
}
