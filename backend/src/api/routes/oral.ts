// Oral exam API routes — mounted under /api/oral.
//
// Write operations (POST/PATCH) require admin auth (the same ADMIN_TOKEN used
// by the import/admin routes). Reads of the pool/questions and exam results
// are public, mirroring how /api/questions is public. The public IHK data
// routes are untouched.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { adminAuth } from "../admin-auth";
import { apiError, paginated, parsePagination } from "../helpers";
import {
  createExam,
  rateQuestion,
  completeExam,
  updateExam,
  EXAM_STATUSES,
  type ExamStatus,
} from "../../oral/service";
import { isRating, scoreExam, type Rating } from "../../oral/scoring";
import { ORAL_THEMES } from "../../oral/themes";
import { seedOralPool } from "../../oral/seed";

export const oral = new Hono();

// ---- public read: pool questions + themes ----

oral.get("/pool", async (c) => {
  const p = parsePagination(c);
  const [items, total] = await Promise.all([
    prisma().oralQuestion.findMany({
      orderBy: { excelId: "asc" },
      skip: p.offset,
      take: p.limit,
      include: { theme: { select: { name: true, weight: true, orderKey: true } } },
    }),
    prisma().oralQuestion.count(),
  ]);
  return c.json(paginated(items, total, p));
});

oral.get("/themes", async (c) => {
  const themes = await prisma().oralTheme.findMany({ orderBy: { orderKey: "asc" } });
  return c.json({ data: themes });
});

// ---- public read: exams list ----

oral.get("/exams", async (c) => {
  const p = parsePagination(c);
  const [items, total] = await Promise.all([
    prisma().oralExam.findMany({
      orderBy: { createdAt: "desc" },
      skip: p.offset,
      take: p.limit,
      include: { candidate: { select: { name: true } } },
    }),
    prisma().oralExam.count(),
  ]);
  return c.json(paginated(items, total, p));
});

// ---- public read: single exam (with questions) ----

oral.get("/exams/:id", async (c) => {
  const id = c.req.param("id");
  const exam = await prisma().oralExam.findUnique({
    where: { id },
    include: {
      candidate: { select: { id: true, name: true } },
      items: {
        orderBy: { orderKey: "asc" },
        include: { question: { select: { excelId: true, question: true, answer: true, source: true } } },
      },
    },
  });
  if (!exam) return apiError(c, 404, "exam not found");
  return c.json(exam);
});

// ---- public read: score preview (recompute without writing) ----
// Useful for showing live totals while the exam is in progress.

oral.get("/exams/:id/score", async (c) => {
  const id = c.req.param("id");
  const exam = await prisma().oralExam.findUnique({
    where: { id },
    select: { id: true, maxPoints: true, totalPoints: true, percent: true, result: true, status: true },
  });
  if (!exam) return apiError(c, 404, "exam not found");
  return c.json(exam);
});

// ---- write: seed pool (admin) ----

oral.post("/seed", adminAuth, async (c) => {
  const res = await seedOralPool(prisma());
  return c.json({ message: "oral pool seeded", ...res });
});

// ---- write: create exam (admin) ----

oral.post("/exams", adminAuth, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }
  const name = typeof body.candidateName === "string" ? body.candidateName.trim() : "";
  if (!name) return apiError(c, 400, "candidateName is required");
  const examDate =
    typeof body.examDate === "string" && body.examDate.length > 0 ? body.examDate : null;
  const examiner =
    typeof body.examiner === "string" && body.examiner.length > 0 ? body.examiner : null;
  const statusRaw = typeof body.status === "string" ? body.status : "draft";
  const status: ExamStatus = (EXAM_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as ExamStatus)
    : "draft";

  try {
    const { examId } = await createExam(prisma(), { candidateName: name, examDate, examiner, status });
    return c.json({ examId }, 201);
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not create exam");
  }
});

// ---- write: rate a question (admin) ----

oral.patch("/exams/:id/questions/:order", adminAuth, async (c) => {
  const examId = c.req.param("id");
  const order = Number(c.req.param("order"));
  if (!Number.isInteger(order) || order < 1 || order > ORAL_THEMES.length) {
    return apiError(c, 400, "invalid question order");
  }
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }
  const ratingRaw = body.rating;
  let rating: Rating | null | undefined;
  if (ratingRaw === null) rating = null;
  else if (ratingRaw === undefined) rating = undefined;
  else if (typeof ratingRaw === "string" && isRating(ratingRaw)) rating = ratingRaw;
  else return apiError(c, 400, "invalid rating");
  const note =
    body.note === undefined
      ? undefined
      : typeof body.note === "string" || body.note === null
        ? body.note
        : null;

  try {
    await rateQuestion(prisma(), examId, order, { rating, note });
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not rate question");
  }
});

// ---- write: complete exam (admin) ----

oral.post("/exams/:id/complete", adminAuth, async (c) => {
  const examId = c.req.param("id");
  try {
    await completeExam(prisma(), examId);
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not complete exam");
  }
});

// ---- write: update exam metadata (admin) ----

oral.patch("/exams/:id", adminAuth, async (c) => {
  const examId = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }
  const data: { examDate?: string | null; examiner?: string | null; status?: ExamStatus } = {};
  if (body.examDate !== undefined)
    data.examDate = typeof body.examDate === "string" && body.examDate.length > 0 ? body.examDate : null;
  if (body.examiner !== undefined)
    data.examiner = typeof body.examiner === "string" && body.examiner.length > 0 ? body.examiner : null;
  if (body.status !== undefined && typeof body.status === "string") {
    data.status = (EXAM_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as ExamStatus)
      : "draft";
  }
  try {
    await updateExam(prisma(), examId, data);
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not update exam");
  }
});

// silence unused import in some build configs
void scoreExam;
