// Oral exam service: create / rate / complete / read exams.
//
// Phase 11 changes:
//   - new exams are created with scoringVersion 2 (weighted percentage),
//   - the rotating 13th question's theme comes from the persisted, atomically
//     advanced rotation counter (advanced INSIDE the creation transaction, so a
//     failed creation does not burn a slot and parallel starts stay distinct),
//   - the cached score is recomputed with the scorer matching the exam's
//     scoringVersion, so pre-Phase-11 exams keep their historical result.
//
// All write operations run in a transaction and the concrete question set is
// created immutably (never regenerated).

import { PrismaClient } from "@prisma/client";
import { drawExam, groupByTheme, type Rng } from "./randomize";
import {
  scoreExam,
  scoreExamLegacy,
  isRating,
  ORAL_MAX_POINTS,
  type Rating,
} from "./scoring";
import { ORAL_TOTAL_WEIGHT, normalizeThemeName } from "./themes";
import { advanceRotation } from "./rotation";

/** Current grading model. Exams created now use the weighted percentage model. */
export const SCORING_VERSION_PERCENT = 2;
/** Legacy points model, retained for pre-Phase-11 exams. */
export const SCORING_VERSION_POINTS = 1;

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
  /** Creating account (audit only — every staff member may run every exam). */
  userId?: string | null;
}

export interface RateInput {
  rating?: Rating | null;
  /** Examiner note (Prüferkommentar). */
  note?: string | null;
  /** The candidate's own answer as documented during the exam. */
  candidateAnswer?: string | null;
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Recompute and persist the cached score for an exam from its items, using the
 * scorer that matches the exam's scoringVersion.
 *
 * `normalizeThemeName` maps pre-Phase-11 theme snapshots (Gewerberecht /
 * Recht der oeffentlichen Sicherheit und Ordnung) onto the merged theme so a
 * historical exam is still grouped correctly.
 */
async function recomputeScoreTx(tx: Tx, examId: string): Promise<void> {
  const exam = await tx.oralExam.findUnique({
    where: { id: examId },
    select: { scoringVersion: true },
  });
  if (!exam) throw new Error("exam not found");

  const items = await tx.oralExamQuestion.findMany({
    where: { examId },
    select: { weight: true, rating: true, themeName: true },
  });

  if (exam.scoringVersion === SCORING_VERSION_POINTS) {
    // Legacy: per-question points, percent = points/100. Untouched math.
    const scored = scoreExamLegacy(
      items.map((i) => ({ weight: i.weight, rating: (i.rating as Rating | null) ?? null })),
      ORAL_MAX_POINTS,
    );
    await tx.oralExam.update({
      where: { id: examId },
      data: {
        maxPoints: scored.maxPoints,
        totalPoints: scored.totalPoints,
        percent: scored.percent,
        result: scored.result,
      },
    });
    return;
  }

  // Current: weighted percentage.
  const scored = scoreExam(
    items.map((i) => ({
      themeName: normalizeThemeName(i.themeName),
      weight: i.weight,
      rating: (i.rating as Rating | null) ?? null,
    })),
  );
  await tx.oralExam.update({
    where: { id: examId },
    data: {
      maxPoints: ORAL_MAX_POINTS, // legacy column, not displayed any more
      totalPoints: 0, // legacy column, not displayed any more
      percent: scored.percent,
      result: scored.result,
    },
  });
}

async function recomputeScore(db: PrismaClient, examId: string): Promise<void> {
  await db.$transaction((tx) => recomputeScoreTx(tx, examId));
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

  // Build the per-theme pool map from the stored themes/questions.
  const themes = await db.oralTheme.findMany();
  const themeNameById = new Map(themes.map((t) => [t.id, normalizeThemeName(t.name)]));
  // `question`/`answer` are read here so the exam can freeze the wording the
  // candidate was actually asked. The pool row may be rewritten later by a
  // re-import; the exam must not follow that change.
  const allQ = await db.oralQuestion.findMany({
    select: { id: true, excelId: true, themeId: true, question: true, answer: true },
  });
  const snapshotById = new Map(
    allQ.map((q) => [q.id, { questionText: q.question, answerText: q.answer }]),
  );
  const pool = allQ.map((q) => ({
    id: q.id,
    excelId: q.excelId,
    themeName: themeNameById.get(q.themeId) ?? "",
  }));
  if (pool.length === 0) throw new Error("oral question pool is empty — run seed first");
  const perTheme = groupByTheme(pool);

  // Persist candidate + exam + questions atomically. The rotation is advanced
  // inside this transaction: on failure it rolls back (no burnt slot).
  //
  // SQLite allows only one writer at a time, so concurrent exam starts queue on
  // the write lock. Prisma's default interactive-transaction budget (2s wait /
  // 5s runtime) is too tight for that queue and surfaces as a spurious
  // "Operations timed out" instead of simply waiting its turn. The generous
  // budget below lets parallel starts serialise cleanly; each transaction is
  // short, so the queue drains in milliseconds.
  const examId = await db.$transaction(
    async (tx) => {
      const { theme: rotationTheme } = await advanceRotation(tx);
      const slots = drawExam(rng, perTheme, rotationTheme);

      const candidate = await tx.oralCandidate.upsert({
        where: { name },
        create: { name },
        update: {},
      });

      const exam = await tx.oralExam.create({
        data: {
          candidateId: candidate.id,
          userId: input.userId ?? null,
          examDate: input.examDate ? new Date(input.examDate) : null,
          examiner: input.examiner ?? null,
          status: input.status ?? "draft",
          scoringVersion: SCORING_VERSION_PERCENT,
          maxPoints: ORAL_TOTAL_WEIGHT,
        },
      });

      // Snapshot theme name, theme weight AND the full question wording at
      // creation, so the exam stays stable even if the pool/themes change later.
      await tx.oralExamQuestion.createMany({
        data: slots.map((s) => {
          const snap = snapshotById.get(s.questionId);
          return {
            examId: exam.id,
            questionId: s.questionId,
            orderKey: s.orderKey,
            themeName: s.themeName,
            weight: s.weight,
            questionText: snap?.questionText ?? null,
            answerText: snap?.answerText ?? null,
            rating: null,
            points: 0, // legacy column; percent scoring does not use it
            note: null,
            candidateAnswer: null,
          };
        }),
      });

      await recomputeScoreTx(tx, exam.id);
      return exam.id;
    },
    { maxWait: 30_000, timeout: 30_000 },
  );

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

    // `points` is a legacy column only; the percentage model derives everything
    // from the rating, so it is kept at 0 and never read by the scorer.
    await tx.oralExamQuestion.update({
      where: { id: item.id },
      data: {
        rating: rating ?? null,
        points: 0,
        note: input.note === undefined ? item.note : input.note,
        candidateAnswer:
          input.candidateAnswer === undefined ? item.candidateAnswer : input.candidateAnswer,
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

export interface DeleteExamResult {
  deletedExamId: string;
  deletedItems: number;
  /** Candidate rows removed because no other exam referenced them any more. */
  deletedCandidates: string[];
}

/**
 * Delete one exam and its dependent exam entries, atomically.
 *
 * Guarantees:
 *   - runs in a single transaction, so an exam is never left half-deleted;
 *   - removes ONLY OralExamQuestion rows belonging to this exam (the question
 *     pool in OralQuestion/OralTheme is never touched, and historical exams of
 *     other candidates keep their exact question set and ratings);
 *   - a candidate is deleted only when it has no remaining exams — candidates
 *     shared with other exams are kept;
 *   - throws ExamNotFoundError on an unknown id (mapped to HTTP 404 by the
 *     route) without having performed any write.
 */
export async function deleteExam(db: PrismaClient, examId: string): Promise<DeleteExamResult> {
  return db.$transaction(async (tx) => {
    const exam = await tx.oralExam.findUnique({
      where: { id: examId },
      select: { id: true, candidateId: true },
    });
    if (!exam) throw new ExamNotFoundError(examId);

    const items = await tx.oralExamQuestion.deleteMany({ where: { examId } });
    await tx.oralExam.delete({ where: { id: examId } });

    const deletedCandidates: string[] = [];
    const remaining = await tx.oralExam.count({ where: { candidateId: exam.candidateId } });
    if (remaining === 0) {
      await tx.oralCandidate.delete({ where: { id: exam.candidateId } });
      deletedCandidates.push(exam.candidateId);
    }

    return { deletedExamId: examId, deletedItems: items.count, deletedCandidates };
  });
}

/** Thrown by deleteExam for an unknown exam id (mapped to HTTP 404). */
export class ExamNotFoundError extends Error {
  constructor(examId: string) {
    super(`exam not found: ${examId}`);
    this.name = "ExamNotFoundError";
  }
}
