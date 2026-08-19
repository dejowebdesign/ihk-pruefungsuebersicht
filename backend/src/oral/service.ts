// Oral exam service: create / rate / complete / read exams.
//
// All write operations run inside a transaction and create the concrete
// question set immutably at creation time (never regenerated). Scoring is
// delegated to scoring.ts (the 1:1 Excel mirror) and the cached result on
// OralExam is recomputed on every change so readers always see consistent
// numbers.

import { PrismaClient } from "@prisma/client";
import { drawExam, groupByTheme, type Rng } from "./randomize";
import { scoreExam, isRating, type Rating } from "./scoring";

export type ExamStatus = "draft" | "in_progress" | "completed";

export const EXAM_STATUSES: readonly ExamStatus[] = [
  "draft",
  "in_progress",
  "completed",
] as const;

export interface CreateExamInput {
  candidateName: string;
  examDate?: string | null; // ISO date
  examiner?: string | null;
  status?: ExamStatus;
}

export interface RateInput {
  rating?: Rating | null;
  note?: string | null;
}

/** Recompute and persist the cached score for an exam from its items. */
async function recomputeScore(db: PrismaClient, examId: string): Promise<void> {
  const items = await db.oralExamQuestion.findMany({
    where: { examId },
    select: { weight: true, rating: true },
  });
  const scored = scoreExam(items.map((i) => ({ weight: i.weight, rating: (i.rating as Rating | null) ?? null })));
  await db.oralExam.update({
    where: { id: examId },
    data: {
      maxPoints: scored.maxPoints,
      totalPoints: scored.totalPoints,
      percent: scored.percent,
      result: scored.result,
    },
  });
}

/**
 * Create a new exam with a freshly drawn, persisted question set.
 * The candidate is created by name (so the same name reuses a candidate row).
 */
export async function createExam(
  db: PrismaClient,
  input: CreateExamInput,
  rng: Rng = Math.random,
): Promise<{ examId: string }> {
  const name = input.candidateName.trim();
  if (!name) throw new Error("candidateName is required");

  // Build per-theme pool map.
  const themes = await db.oralTheme.findMany();
  const themeNameById = new Map(themes.map((t) => [t.id, t.name]));
  const allQ = await db.oralQuestion.findMany({
    select: { id: true, excelId: true, themeId: true },
  });
  const pool = allQ.map((q) => ({
    id: q.id,
    excelId: q.excelId,
    themeName: themeNameById.get(q.themeId) ?? "",
  }));
  if (pool.length === 0) throw new Error("oral question pool is empty — run seed first");
  const perTheme = groupByTheme(pool);

  const slots = drawExam(rng, perTheme);

  // Persist candidate + exam + questions atomically.
  const examId = await db.$transaction(async (tx) => {
    const candidate = await tx.oralCandidate.upsert({
      where: { name },
      create: { name },
      update: {},
    });

    const exam = await tx.oralExam.create({
      data: {
        candidateId: candidate.id,
        examDate: input.examDate ? new Date(input.examDate) : null,
        examiner: input.examiner ?? null,
        status: input.status ?? "draft",
        maxPoints: 100,
      },
    });

    // Snapshot theme name + weight at creation so the exam is stable even if
    // the pool/themes change later.
    await tx.oralExamQuestion.createMany({
      data: slots.map((s) => ({
        examId: exam.id,
        questionId: s.questionId,
        orderKey: s.orderKey,
        themeName: s.themeName,
        weight: s.weight,
        rating: null,
        points: 0,
        note: null,
      })),
    });

    return exam.id;
  });

  await recomputeScore(db, examId);
  return { examId };
}

/** Rate a single exam question (and recompute the exam score). */
export async function rateQuestion(
  db: PrismaClient,
  examId: string,
  orderKey: number,
  input: RateInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const item = await tx.oralExamQuestion.findFirst({
      where: { examId, orderKey },
    });
    if (!item) throw new Error("exam question not found");

    const rating = input.rating === undefined ? item.rating : input.rating;
    if (rating !== null && rating !== undefined && !isRating(rating)) {
      throw new Error(`invalid rating: ${rating}`);
    }

    const points =
      rating === "richtig"
        ? item.weight
        : rating === "teilweise richtig"
          ? item.weight / 2
          : 0;

    await tx.oralExamQuestion.update({
      where: { id: item.id },
      data: {
        rating: rating ?? null,
        points,
        note: input.note === undefined ? item.note : input.note,
      },
    });

    // Keep exam status moving: any rating ⇒ in_progress (unless completed).
    const exam = await tx.oralExam.findUnique({ where: { id: examId } });
    if (exam && exam.status === "draft") {
      await tx.oralExam.update({ where: { id: examId }, data: { status: "in_progress" } });
    }
  });
  await recomputeScore(db, examId);
}

/** Mark an exam completed (finalizes the score snapshot). */
export async function completeExam(db: PrismaClient, examId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await recomputeScoreTx(tx, examId);
    await tx.oralExam.update({
      where: { id: examId },
      data: { status: "completed", completedAt: new Date() },
    });
  });
}

/** Update exam metadata (date/examiner/status) without touching questions. */
export async function updateExam(
  db: PrismaClient,
  examId: string,
  input: { examDate?: string | null; examiner?: string | null; status?: ExamStatus },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (input.examDate !== undefined) data.examDate = input.examDate ? new Date(input.examDate) : null;
  if (input.examiner !== undefined) data.examiner = input.examiner ?? null;
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === "completed") data.completedAt = new Date();
  }
  await db.oralExam.update({ where: { id: examId }, data });
  if (input.status) await recomputeScore(db, examId);
}

/** Tx-scoped recompute (used inside transactions). */
async function recomputeScoreTx(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  examId: string,
): Promise<void> {
  const items = await tx.oralExamQuestion.findMany({
    where: { examId },
    select: { weight: true, rating: true },
  });
  const scored = scoreExam(items.map((i) => ({ weight: i.weight, rating: (i.rating as Rating | null) ?? null })));
  await tx.oralExam.update({
    where: { id: examId },
    data: {
      maxPoints: scored.maxPoints,
      totalPoints: scored.totalPoints,
      percent: scored.percent,
      result: scored.result,
    },
  });
}
