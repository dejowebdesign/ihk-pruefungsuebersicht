-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'participant',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "disabledAt" DATETIME
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OralExam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "userId" TEXT,
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
    CONSTRAINT "OralExam_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "OralCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OralExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OralExam" ("candidateId", "completedAt", "createdAt", "examDate", "examiner", "id", "maxPoints", "percent", "result", "status", "totalPoints", "updatedAt") SELECT "candidateId", "completedAt", "createdAt", "examDate", "examiner", "id", "maxPoints", "percent", "result", "status", "totalPoints", "updatedAt" FROM "OralExam";
DROP TABLE "OralExam";
ALTER TABLE "new_OralExam" RENAME TO "OralExam";
CREATE INDEX "OralExam_candidateId_idx" ON "OralExam"("candidateId");
CREATE INDEX "OralExam_status_idx" ON "OralExam"("status");
CREATE INDEX "OralExam_createdAt_idx" ON "OralExam"("createdAt");
CREATE INDEX "OralExam_userId_idx" ON "OralExam"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

