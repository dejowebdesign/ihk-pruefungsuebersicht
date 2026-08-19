-- DropIndex
DROP INDEX "IhkLocation_ihkShortName_key";

-- CreateTable
CREATE TABLE "OralTheme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderKey" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "OralQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "excelId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "nr" INTEGER,
    "source" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "checked" TEXT,
    CONSTRAINT "OralQuestion_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "OralTheme" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OralCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OralExam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "examDate" DATETIME,
    "examiner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "maxPoints" INTEGER NOT NULL DEFAULT 100,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "percent" REAL NOT NULL DEFAULT 0,
    "result" TEXT,
    CONSTRAINT "OralExam_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "OralCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OralExamQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderKey" INTEGER NOT NULL,
    "themeName" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "rating" TEXT,
    "points" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "OralExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "OralExam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OralExamQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "OralQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OralTheme_orderKey_key" ON "OralTheme"("orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "OralTheme_name_key" ON "OralTheme"("name");

-- CreateIndex
CREATE INDEX "OralTheme_orderKey_idx" ON "OralTheme"("orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "OralQuestion_excelId_key" ON "OralQuestion"("excelId");

-- CreateIndex
CREATE INDEX "OralQuestion_themeId_idx" ON "OralQuestion"("themeId");

-- CreateIndex
CREATE INDEX "OralQuestion_excelId_idx" ON "OralQuestion"("excelId");

-- CreateIndex
CREATE UNIQUE INDEX "OralCandidate_name_key" ON "OralCandidate"("name");

-- CreateIndex
CREATE INDEX "OralCandidate_name_idx" ON "OralCandidate"("name");

-- CreateIndex
CREATE INDEX "OralExam_candidateId_idx" ON "OralExam"("candidateId");

-- CreateIndex
CREATE INDEX "OralExam_status_idx" ON "OralExam"("status");

-- CreateIndex
CREATE INDEX "OralExam_createdAt_idx" ON "OralExam"("createdAt");

-- CreateIndex
CREATE INDEX "OralExamQuestion_examId_idx" ON "OralExamQuestion"("examId");

-- CreateIndex
CREATE INDEX "OralExamQuestion_questionId_idx" ON "OralExamQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "OralExamQuestion_examId_orderKey_key" ON "OralExamQuestion"("examId", "orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "OralExamQuestion_examId_questionId_key" ON "OralExamQuestion"("examId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "IhkLocation_importRunId_ihkShortName_key" ON "IhkLocation"("importRunId", "ihkShortName");

