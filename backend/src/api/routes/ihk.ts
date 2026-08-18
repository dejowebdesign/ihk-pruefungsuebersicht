// IHK location endpoints: list (filtered), detail, search.
// All scoped to the latest successful ImportRun.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import type { Prisma } from "@prisma/client";
import { apiError, latestSuccessRun, paginated, parsePagination, qStr } from "../helpers";

export const ihk = new Hono();

// GET /api/ihk — list with filters + pagination.
ihk.get("/", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const p = parsePagination(c);
  const where: Prisma.IhkLocationWhereInput = { importRunId: run.id };

  const bundesland = qStr(c, "bundesland");
  const skp = qStr(c, "skp");
  const writtenForm = qStr(c, "writtenForm");
  const writtenResultImmediate = qStr(c, "writtenResultImmediate");
  const sameDay = qStr(c, "sameDay");
  const intervalWrittenOral = qStr(c, "intervalWrittenOral");
  const groupFormat = qStr(c, "groupFormat");

  if (bundesland) where.bundesland = bundesland;
  if (skp) where.skp = skp;
  if (writtenForm) where.writtenForm = writtenForm;
  if (writtenResultImmediate) where.writtenResultImmediate = writtenResultImmediate;
  if (sameDay) where.sameDay = sameDay;
  if (intervalWrittenOral) where.intervalWrittenOral = intervalWrittenOral;
  if (groupFormat) where.groupFormat = groupFormat;

  const [items, total] = await Promise.all([
    prisma().ihkLocation.findMany({
      where,
      orderBy: { nr: "asc" },
      skip: p.offset,
      take: p.limit,
      select: IHK_LIST_SELECT,
    }),
    prisma().ihkLocation.count({ where }),
  ]);

  return c.json(paginated(items, total, p));
});

// GET /api/ihk/search?q=bie — search short name, official name, bundesland.
ihk.get("/search", async (c) => {
  // Validate input before checking data availability (faster failure).
  const q = qStr(c, "q");
  if (!q || q.length < 2) {
    return apiError(c, 400, "query param 'q' must be at least 2 characters");
  }
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const p = parsePagination(c);
  const term = q;
  const where: Prisma.IhkLocationWhereInput = {
    importRunId: run.id,
    OR: [
      { ihkShortName: { contains: term } },
      { officialName: { contains: term } },
      { bundesland: { contains: term } },
    ],
  };
  const [items, total] = await Promise.all([
    prisma().ihkLocation.findMany({
      where,
      orderBy: { nr: "asc" },
      skip: p.offset,
      take: p.limit,
      select: IHK_LIST_SELECT,
    }),
    prisma().ihkLocation.count({ where }),
  ]);
  return c.json(paginated(items, total, p));
});

// GET /api/ihk/:id — full detail + provenance (sheet + import time).
ihk.get("/:id", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const id = c.req.param("id");
  const loc = await prisma().ihkLocation.findFirst({
    where: { id, importRunId: run.id },
    include: {
      sourceSheet: { select: { id: true, originalName: true, sheetType: true, gid: true } },
      importRun: { select: { id: true, startedAt: true, finishedAt: true, source: true, snapshotVersion: true } },
      semantics: { select: { id: true, field: true, value: true, sourceRowNumber: true } },
    },
  });
  if (!loc) return apiError(c, 404, "IHK location not found");
  return c.json(loc);
});

const IHK_LIST_SELECT = {
  id: true,
  nr: true,
  ihkShortName: true,
  officialName: true,
  skp: true,
  bundesland: true,
  writtenForm: true,
  writtenResultImmediate: true,
  sameDay: true,
  intervalWrittenOral: true,
  examinerCount: true,
  groupFormat: true,
  dataState: true,
  lastUpdatedRaw: true,
} as const;
