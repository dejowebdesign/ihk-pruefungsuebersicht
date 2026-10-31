-- Question snapshots for oral exam items.
--
-- WHY: the report must show the wording the candidate was ACTUALLY asked. Until
-- now an exam item linked to the live pool row (questionId) and read the text
-- through that relation, so a later pool edit (re-import, correction) silently
-- rewrote every historical report. The snapshot columns freeze the wording.
--
-- Existing rows are backfilled from the pool row they are currently linked to.
-- That is the only truthful source available: the item recorded WHICH question
-- was asked, and the linked row is the best surviving copy of its wording. No
-- text is invented, and nothing is deleted. A row whose question was deleted
-- (impossible today — the FK is ON DELETE RESTRICT) stays NULL; readers then
-- fall back to the live row.
--
-- This migration is additive and idempotent-safe: it only adds nullable columns
-- and fills them once.

ALTER TABLE "OralExamQuestion" ADD COLUMN "questionText" TEXT;
ALTER TABLE "OralExamQuestion" ADD COLUMN "answerText" TEXT;
ALTER TABLE "OralExamQuestion" ADD COLUMN "candidateAnswer" TEXT;

UPDATE "OralExamQuestion"
   SET "questionText" = (SELECT q."question" FROM "OralQuestion" q WHERE q."id" = "OralExamQuestion"."questionId")
 WHERE "questionText" IS NULL;

UPDATE "OralExamQuestion"
   SET "answerText" = (SELECT q."answer" FROM "OralQuestion" q WHERE q."id" = "OralExamQuestion"."questionId")
 WHERE "answerText" IS NULL;
