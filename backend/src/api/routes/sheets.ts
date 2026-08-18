// Sheets endpoints: list and detail (metadata only, no huge raw payloads).

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import type { Prisma } from "@prisma/client";
import { apiError, latestSuccessRun, paginated, parsePagination, qStr } from "../helpers";

export const sheets = new Hono();

// GET /api/sheets — list all sheets of the latest run.
sheets.get("/", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const p = parsePagination(c);
  const sheetType = qStr(c, "sheetType");
  const where: Prisma.SheetWhereInput = { importRunId: run.id };
  if (sheetType) where.sheetType = sheetType;

  const [items, total] = await Promise.all([
    prisma().sheet.findMany({
      where,
      orderBy: { orderIndex: "asc" },
      skip: p.offset,
      take: p.limit,
      select: {
        id: true,
        originalName: true,
        sheetType: true,
        gid: true,
        orderIndex: true,
        rowCount: true,
        colCount: true,
        parsedAt: true,
      },
    }),
    prisma().sheet.count({ where }),
  ]);
  return c.json(paginated(items, total, p));
});

// GET /api/sheets/:id — sheet metadata + header sample (no raw row dump).
sheets.get("/:id", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const id = c.req.param("id");
  const sheet = await prisma().sheet.findFirst({
    where: { id, importRunId: run.id },
    select: {
      id: true,
      originalName: true,
      sheetType: true,
      gid: true,
      orderIndex: true,
      rowCount: true,
      colCount: true,
      headers: true,
      parsedAt: true,
      importRun: {
        select: { id: true, startedAt: true, finishedAt: true, source: true },
      },
      _count: { select: { rawRows: true, ihkLocations: true, questions: true, caseExamples: true, semantics: true } },
    },
  });
  if (!sheet) return apiError(c, 404, "sheet not found");
  return c.json(sheet);
});
