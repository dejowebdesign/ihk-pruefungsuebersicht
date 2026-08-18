// Public import endpoints: status + run history (metadata only).

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { apiError, paginated, parsePagination } from "../helpers";

export const imp = new Hono();

// GET /api/import/status — last success + last attempt summary.
imp.get("/status", async (c) => {
  const db = prisma();
  const lastSuccess = await db.importRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
  const lastAttempt = await db.importRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  return c.json({
    lastSuccess: lastSuccess ? summarizeRun(lastSuccess) : null,
    lastAttempt: lastAttempt ? summarizeRun(lastAttempt) : null,
  });
});

// GET /api/import/runs — paginated history (metadata only, no raw payloads).
imp.get("/runs", async (c) => {
  const p = parsePagination(c);
  const db = prisma();
  const [items, total] = await Promise.all([
    db.importRun.findMany({
      orderBy: { startedAt: "desc" },
      skip: p.offset,
      take: p.limit,
      select: {
        id: true,
        status: true,
        source: true,
        sourceRef: true,
        startedAt: true,
        finishedAt: true,
        sheetsDetected: true,
        sheetsImported: true,
        sheetFailures: true,
        dataRecords: true,
        ihkLocations: true,
        questions: true,
        caseExamples: true,
        changeCount: true,
        snapshotVersion: true,
        errors: true,
      },
    }),
    db.importRun.count(),
  ]);
  return c.json(paginated(items, total, p));
});

function summarizeRun(r: {
  id: string;
  status: string;
  source: string;
  sourceRef: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  sheetsDetected: number;
  sheetsImported: number;
  sheetFailures: number;
  dataRecords: number;
  ihkLocations: number;
  questions: number;
  caseExamples: number;
  changeCount: number;
  snapshotVersion: string | null;
  errors: string | null;
}) {
  return {
    id: r.id,
    status: r.status,
    source: r.source,
    sourceRef: r.sourceRef,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    sheetsDetected: r.sheetsDetected,
    sheetsImported: r.sheetsImported,
    sheetFailures: r.sheetFailures,
    dataRecords: r.dataRecords,
    ihkLocations: r.ihkLocations,
    questions: r.questions,
    caseExamples: r.caseExamples,
    changeCount: r.changeCount,
    snapshotVersion: r.snapshotVersion,
    lastError: r.errors,
  };
}
