// Oral exam API routes — mounted under /api/oral.
//
// This is the examiner's working area, so BOTH staff roles (admin and examiner)
// have the full set of rights here:
//   - reads (themes, pool, exam list, exam detail, score, PDF) require a signed-in
//     identity, and every examiner sees ALL exams — running an exam does not
//     depend on who created it.
//   - writes (create, rate, complete, update, delete) require a signed-in staff
//     member too. Only seeding the shared question pool stays admin-only.
//
// The legacy ADMIN_TOKEN still works and maps to the admin role (see
// api/identity.ts), so existing tooling is unaffected.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { requireAdmin, requireStaff, type AuthVariables } from "../identity";
import { apiError, paginated, parsePagination } from "../helpers";
import {
  createExam,
  rateQuestion,
  completeExam,
  updateExam,
  deleteExam,
  ExamNotFoundError,
  EXAM_STATUSES,
  type ExamStatus,
} from "../../oral/service";
import { isRating, scoreExam, type Rating } from "../../oral/scoring";
import { ORAL_QUESTIONS_PER_EXAM, normalizeThemeName } from "../../oral/themes";
import { seedOralPool } from "../../oral/seed";
import { loadExamReport, buildExamReportPdf, reportFileName } from "../../oral/pdf";

export const oral = new Hono<{ Variables: AuthVariables }>();

// ---- read: pool questions + themes ----

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

// ---- read: exams list (all exams, both roles) ----

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

// ---- read: single exam ----

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

  // The per-theme weighted breakdown is derived here, from the STORED ratings,
  // so every client (web UI, PDF, future consumers) shows identical numbers.
  // Legacy exams (scoringVersion 1) are points-based; they expose their stored
  // percent only and carry no percentage breakdown.
  const breakdown =
    exam.scoringVersion === 2
      ? scoreExam(
          exam.items.map((i) => ({
            themeName: normalizeThemeName(i.themeName),
            weight: i.weight,
            rating: (i.rating as Rating | null) ?? null,
          })),
        ).themes
      : undefined;

  // Expose the question wording the candidate was ACTUALLY asked. The item
  // snapshot wins; rows created before the snapshot existed fall back to the
  // linked pool row, which for them is the only surviving copy. `question` is
  // replaced by the resolved snapshot so every client renders the same text
  // without needing to know about the fallback.
  const items = exam.items.map((i) => ({
    ...i,
    question: {
      ...i.question,
      question: i.questionText ?? i.question.question,
      answer: i.answerText ?? i.question.answer,
    },
  }));

  return c.json({ ...exam, items, breakdown });
});

// ---- read: score (read-only — never recomputes/writes) ----

oral.get("/exams/:id/score", async (c) => {
  const id = c.req.param("id");
  const exam = await prisma().oralExam.findUnique({
    where: { id },
    select: {
      id: true,
      percent: true,
      result: true,
      status: true,
      scoringVersion: true,
    },
  });
  if (!exam) return apiError(c, 404, "exam not found");
  return c.json(exam);
});

// ---- read: PDF report of a COMPLETED exam ----
// The report renders the stored values only (no recomputation), so it always
// matches what the app shows. Only completed exams have a report: a draft or
// in-progress exam has no final result to attest to, and an unknown id is 404.

oral.get("/exams/:id/pdf", async (c) => {
  const id = c.req.param("id");

  const data = await loadExamReport(prisma(), id);
  if (!data) return apiError(c, 404, "exam not found");

  if (data.exam.status !== "completed") {
    return apiError(c, 409, "exam is not completed yet");
  }

  const pdf = buildExamReportPdf(data);
  const filename = reportFileName(data);
  const disposition = c.req.query("disposition") === "attachment" ? "attachment" : "inline";

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      // Exam results are personal data — never cache them in shared proxies.
      "Cache-Control": "private, no-store",
    },
  });
});

// ---- write: seed pool (admin) ----

oral.post("/seed", requireAdmin, async (c) => {
  const res = await seedOralPool(prisma());
  return c.json({ message: "oral pool seeded", ...res });
});

// ---- write: create exam (staff) ----

oral.post("/exams", requireStaff, async (c) => {
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

  // The creator is recorded from the authenticated identity ONLY; `userId` in
  // the request body is ignored so a caller cannot attribute an exam to someone
  // else. This is audit information — every staff member may run every exam.
  const identity = c.get("identity");

  try {
    const { examId } = await createExam(prisma(), {
      candidateName: name,
      examDate,
      examiner,
      status,
      userId: identity?.userId ?? null,
    });
    return c.json({ examId }, 201);
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not create exam");
  }
});

// ---- write: rate a question (staff) ----

oral.patch("/exams/:id/questions/:order", requireStaff, async (c) => {
  const examId = c.req.param("id");
  const order = Number(c.req.param("order"));
  if (!Number.isInteger(order) || order < 1 || order > ORAL_QUESTIONS_PER_EXAM) {
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
  const candidateAnswer =
    body.candidateAnswer === undefined
      ? undefined
      : typeof body.candidateAnswer === "string" || body.candidateAnswer === null
        ? body.candidateAnswer
        : null;

  try {
    await rateQuestion(prisma(), examId, order, { rating, note, candidateAnswer });
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "could not rate question";
    if (msg.includes("not found")) return apiError(c, 404, "exam question not found");
    return apiError(c, 400, msg);
  }
});

// ---- write: complete exam (staff) ----

oral.post("/exams/:id/complete", requireStaff, async (c) => {
  const examId = c.req.param("id");
  if (!(await prisma().oralExam.findUnique({ where: { id: examId }, select: { id: true } }))) {
    return apiError(c, 404, "exam not found");
  }
  try {
    await completeExam(prisma(), examId);
    return c.json({ ok: true });
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not complete exam");
  }
});

// ---- write: update exam metadata (staff) ----

oral.patch("/exams/:id", requireStaff, async (c) => {
  const examId = c.req.param("id");
  if (!(await prisma().oralExam.findUnique({ where: { id: examId }, select: { id: true } }))) {
    return apiError(c, 404, "exam not found");
  }
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

// ---- write: delete exam (staff) ----
// Deleting an exam removes its own question slots (and an orphaned candidate)
// inside one transaction. The question pool is never touched. The endpoint is
// destructive, so it is staff-only and deliberately requires an explicit
// confirmation flag — a stray DELETE without intent is rejected with 400.

oral.delete("/exams/:id", requireStaff, async (c) => {
  const examId = c.req.param("id");
  const confirmed =
    c.req.query("confirm") === "true" || c.req.header("x-confirm-delete") === "true";
  if (!confirmed) {
    return apiError(c, 400, "deletion requires explicit confirmation (confirm=true)");
  }
  try {
    const result = await deleteExam(prisma(), examId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof ExamNotFoundError) return apiError(c, 404, "exam not found");
    return apiError(c, 400, e instanceof Error ? e.message : "could not delete exam");
  }
});
