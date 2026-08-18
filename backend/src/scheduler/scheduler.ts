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
