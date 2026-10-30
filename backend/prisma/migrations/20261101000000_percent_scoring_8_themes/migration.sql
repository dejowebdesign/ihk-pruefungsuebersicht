-- Phase 11: 8 themes + weighted percentage scoring.
--
-- Non-destructive migration. Nothing is dropped and no question/rating/history
-- row is deleted:
--   * OralTheme gains `questionsPerExam` (default 1) — additive.
--   * OralExam gains `scoringVersion` (default 2) — additive. Existing exams
--     are then marked scoringVersion=1 so they keep being scored with the
--     legacy points model they were created under (their stored percent is
--     left exactly as it was).
--   * OralRotationState is a new table for the persisted 13th-question rotation.
--   * Gewerberecht + RdOesO are merged into ONE theme. The two legacy theme
--     rows are re-pointed/reused rather than deleted, so every existing
--     OralQuestion row keeps its themeId (no question row is touched).

-- 1) Additive columns -------------------------------------------------------
ALTER TABLE "OralTheme" ADD COLUMN "questionsPerExam" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OralExam" ADD COLUMN "scoringVersion" INTEGER NOT NULL DEFAULT 2;

-- 2) Persisted rotation state (single row) ----------------------------------
CREATE TABLE "OralRotationState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- 3) Park every existing theme row outside the active orderKey range --------
-- orderKey is UNIQUE, so final keys cannot be assigned while the old rows
-- still occupy them (e.g. orderKey 4 is taken by Straf- und Verfahrensrecht).
-- Park all rows first, then assign the final keys in step 4. The Gewerberecht
-- row is parked permanently (90) and never becomes an active theme again, but
-- it is NOT deleted, so its questions can be re-pointed without any risk of
-- orphaning them.
UPDATE "OralTheme" SET "orderKey" = 90 WHERE "name" = 'Gewerberecht / Bewachungsverordnung';
UPDATE "OralTheme" SET "orderKey" = 91 WHERE "name" = 'Recht der oeffentlichen Sicherheit und Ordnung';
UPDATE "OralTheme" SET "orderKey" = 92 WHERE "name" = 'Buergerliches Gesetzbuch / Jedermannsrechte';
UPDATE "OralTheme" SET "orderKey" = 93 WHERE "name" = 'Straf- und Verfahrensrecht';
UPDATE "OralTheme" SET "orderKey" = 94 WHERE "name" = 'Umgang mit Menschen / Deeskalation';
UPDATE "OralTheme" SET "orderKey" = 95 WHERE "name" = 'Umgang mit Waffen';
UPDATE "OralTheme" SET "orderKey" = 96 WHERE "name" = 'Datenschutzrecht';
UPDATE "OralTheme" SET "orderKey" = 97 WHERE "name" = 'Grundlagen der Sicherheitstechnik';
UPDATE "OralTheme" SET "orderKey" = 98 WHERE "name" = 'Unfallverhuetungsvorschriften';

-- Move all Gewerberecht questions onto the surviving RdOesO row (renamed in
-- step 4). No question row is created, changed or deleted — only re-pointed.
UPDATE "OralQuestion"
   SET "themeId" = (SELECT "id" FROM "OralTheme" WHERE "orderKey" = 91)
 WHERE "themeId" = (SELECT "id" FROM "OralTheme" WHERE "orderKey" = 90);

-- 4) Assign the final 8-theme percentage configuration ----------------------
UPDATE "OralTheme"
   SET "name" = 'Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht',
       "weight" = 10, "questionsPerExam" = 2, "orderKey" = 4
 WHERE "orderKey" = 91;
UPDATE "OralTheme" SET "weight" = 18, "questionsPerExam" = 2, "orderKey" = 1 WHERE "orderKey" = 92;
UPDATE "OralTheme" SET "weight" = 18, "questionsPerExam" = 2, "orderKey" = 2 WHERE "orderKey" = 93;
UPDATE "OralTheme" SET "weight" = 18, "questionsPerExam" = 2, "orderKey" = 3 WHERE "orderKey" = 94;
UPDATE "OralTheme" SET "weight" = 9,  "questionsPerExam" = 1, "orderKey" = 7 WHERE "orderKey" = 95;
UPDATE "OralTheme" SET "weight" = 9,  "questionsPerExam" = 1, "orderKey" = 5 WHERE "orderKey" = 96;
UPDATE "OralTheme" SET "weight" = 9,  "questionsPerExam" = 1, "orderKey" = 8 WHERE "orderKey" = 97;
UPDATE "OralTheme" SET "weight" = 9,  "questionsPerExam" = 1, "orderKey" = 6 WHERE "orderKey" = 98;

-- 5) Freeze ALL pre-existing exams onto the legacy points model -------------
-- Every exam that exists at migration time was created under the points model,
-- so its OralExamQuestion.weight snapshot holds a PER-QUESTION point value
-- (e.g. 4/6/8), not a theme weight. Scoring such a row with the percentage
-- model would misinterpret those numbers, so all of them keep scoringVersion 1
-- (their stored percent/result are left exactly as they are, and any later
-- recompute still uses the legacy math).
--
-- Exams created after this migration get scoringVersion 2 from the column
-- default (createExam also sets it explicitly), and their weight snapshot is a
-- genuine theme weight — so the two models never mix within one exam.
UPDATE "OralExam" SET "scoringVersion" = 1;
