// Questions endpoints: list (filtered/searched) + detail.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import type { Prisma } from "@prisma/client";
import { apiError, latestSuccessRun, paginated, parsePagination, qStr } from "../helpers";

export const questions = new Hono();

// GET /api/questions — list with category/difficulty/cluster filters + search.
questions.get("/", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const p = parsePagination(c);
  const where: Prisma.QuestionWhereInput = { importRunId: run.id };

  const category = qStr(c, "category");
  const difficulty = qStr(c, "difficulty");
  const cluster = qStr(c, "cluster");
  const q = qStr(c, "q");

  if (category) where.category = { contains: category };
  if (difficulty) where.difficulty = { contains: difficulty };
  if (cluster) where.cluster = { contains: cluster };
  if (q) {
    where.OR = [
      { question: { contains: q } },
      { answer: { contains: q } },
      { legalBasis: { contains: q } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma().question.findMany({
      where,
      orderBy: { sourceRowNumber: "asc" },
      skip: p.offset,
      take: p.limit,
    }),
    prisma().question.count({ where }),
  ]);
  return c.json(paginated(items, total, p));
});

// GET /api/questions/:id — single question.
questions.get("/:id", async (c) => {
  const run = await latestSuccessRun(prisma());
  if (!run) return apiError(c, 503, "no data available yet");

  const id = c.req.param("id");
  const q = await prisma().question.findFirst({ where: { id, importRunId: run.id } });
  if (!q) return apiError(c, 404, "question not found");
  return c.json(q);
});
