// Oral exam API routes — mounted under /api/oral.
//
// Read/write split:
//   - reads (themes, pool, exam list, exam detail, score, PDF) require a signed-in
//     identity (admin or participant). A PARTICIPANT only ever sees exams whose
//     `userId` is their own — the filter is applied in the SQL query, so foreign
//     exams are not merely hidden but never loaded.
//   - writes (create, rate, complete, update, delete, seed) are admin-only.
//
// The legacy ADMIN_TOKEN still works and maps to the admin role (see
// api/identity.ts), so existing tooling is unaffected.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { requireAdmin, type AuthVariables } from "../identity";
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
import { isRating, type Rating } from "../../oral/scoring";
import { ORAL_QUESTIONS_PER_EXAM } from "../../oral/themes";
import { seedOralPool } from "../../oral/seed";
import { loadExamReport, buildExamReportPdf, reportFileName } from "../../oral/pdf";

export const oral = new Hono<{ Variables: AuthVariables }>();

/** Prisma filter limiting exam reads to what the caller may see. */
function examScope(c: { get: (k: "identity") => AuthVariables["identity"] }) {
  const identity = c.get("identity");
  if (!identity) return { id: "__unauthenticated__" }; // matches nothing
  if (identity.role === "admin") return {};
  // Participants: only their own exams. An exam without an owner is never
  // readable by a participant.
  return { userId: identity.userId ?? "__no_user__" };
}

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

// ---- read: exams list (scoped) ----

oral.get("/exams", async (c) => {
  const p = parsePagination(c);
  const where = examScope(c);
  const [items, total] = await Promise.all([
    prisma().oralExam.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: p.offset,
      take: p.limit,
      include: { candidate: { select: { name: true } } },
    }),
    prisma().oralExam.count({ where }),
  ]);
  return c.json(paginated(items, total, p));
});

// ---- read: single exam (scoped) ----

oral.get("/exams/:id", async (c) => {
  const id = c.req.param("id");
  const identity = c.get("identity");
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
  // A participant asking for someone else's exam gets 404 (not 403) so the
  // existence of foreign exam ids is not confirmed.
  if (identity && identity.role !== "admin" && exam.userId !== identity.userId) {
    return apiError(c, 404, "exam not found");
  }
  return c.json(exam);
});

// ---- read: score (scoped, read-only — never recomputes/writes) ----

oral.get("/exams/:id/score", async (c) => {
  const id = c.req.param("id");
  const identity = c.get("identity");
  const exam = await prisma().oralExam.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      maxPoints: true,
      totalPoints: true,
      percent: true,
      result: true,
      status: true,
    },
  });
  if (!exam) return apiError(c, 404, "exam not found");
  if (identity && identity.role !== "admin" && exam.userId !== identity.userId) {
    return apiError(c, 404, "exam not found");
  }
  const { userId: _userId, ...rest } = exam;
  return c.json(rest);
});

// ---- read: PDF report of a COMPLETED exam ----
// The report renders the stored values only (no recomputation), so it always
// matches what the app shows. Only completed exams have a report: a draft or
// in-progress exam has no final result to attest to, and an unknown id is 404.

oral.get("/exams/:id/pdf", async (c) => {
  const id = c.req.param("id");
  const identity = c.get("identity");

  const data = await loadExamReport(prisma(), id);
  if (!data) return apiError(c, 404, "exam not found");

  if (identity && identity.role !== "admin") {
    const owner = await prisma().oralExam.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (owner?.userId !== identity.userId) return apiError(c, 404, "exam not found");
  }

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

// ---- write: create exam (admin) ----

oral.post("/exams", requireAdmin, async (c) => {
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

  // Ownership is derived from the authenticated identity ONLY. `userId` in the
  // request body is ignored so a caller cannot assign an exam to someone else.
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

// ---- write: rate a question (admin) ----

oral.patch("/exams/:id/questions/:order", requireAdmin, async (c) => {
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

  try {
    await rateQuestion(prisma(), examId, order, { rating, note });
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "could not rate question";
    if (msg.includes("not found")) return apiError(c, 404, "exam question not found");
    return apiError(c, 400, msg);
  }
});

// ---- write: complete exam (admin) ----

oral.post("/exams/:id/complete", requireAdmin, async (c) => {
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

// ---- write: update exam metadata (admin) ----

oral.patch("/exams/:id", requireAdmin, async (c) => {
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

// ---- write: delete exam (admin) ----
// Deleting an exam removes its own question slots (and an orphaned candidate)
// inside one transaction. The question pool is never touched. The endpoint is
// destructive, so it is admin-only and deliberately requires an explicit
// confirmation flag — a stray DELETE without intent is rejected with 400.

oral.delete("/exams/:id", requireAdmin, async (c) => {
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
