// Case examples endpoints: list (filtered/searched) + detail.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import type { Prisma } from "@prisma/client";
import { apiError, latestSuccessRun, paginated, parsePagination, qStr } from "../helpers";

export const caseExamples = new Hono();

// GET /api/case-examples — list with category/cluster filters + search.
caseExamples.get("/", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const p = parsePagination(c);
  const where: Prisma.CaseExampleWhereInput = { importRunId: run.id };

  const category = qStr(c, "category");
  const cluster = qStr(c, "cluster");
  const q = qStr(c, "q");
  if (category) where.category = { contains: category };
  if (cluster) where.cluster = { contains: cluster };
  if (q) {
    where.OR = [
      { scenario: { contains: q } },
      { perfectAnswer: { contains: q } },
      { legalBasis: { contains: q } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma().caseExample.findMany({
      where,
      orderBy: { sourceRowNumber: "asc" },
      skip: p.offset,
      take: p.limit,
    }),
    prisma().caseExample.count({ where }),
  ]);
  return c.json(paginated(items, total, p));
});

// GET /api/case-examples/:id — single case example.
caseExamples.get("/:id", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const id = c.req.param("id");
  const ce = await prisma().caseExample.findFirst({ where: { id, importRunId: run.id } });
  if (!ce) return apiError(c, 404, "case example not found");
  return c.json(ce);
});
