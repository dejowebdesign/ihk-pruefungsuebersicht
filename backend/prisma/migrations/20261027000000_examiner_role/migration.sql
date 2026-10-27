-- Retire the "participant" role in favour of "examiner".
--
-- Two changes, both data-preserving:
--   1. every existing User row with role = 'participant' becomes 'examiner'
--      (accounts, usernames, password hashes, active flag, disabledAt and the
--      exams referencing them are all kept — only the role string changes);
--   2. the column default for NEW rows becomes 'examiner'.
--
-- SQLite cannot alter a column default in place, so the column default change
-- requires Prisma's standard table rebuild. The INSERT..SELECT below copies
-- every row and performs the role conversion in the same statement, so there is
-- no window in which a row is missing or half-converted. No table other than
-- "User" is rebuilt, and no row is ever deleted.
--
-- Note: Session and OralExam reference "User" by name and keep doing so after
-- the rebuild; their rows are untouched (the FK is enforced again at the end).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'examiner',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "disabledAt" DATETIME
);
INSERT INTO "new_User" ("active", "createdAt", "disabledAt", "id", "passwordHash", "role", "updatedAt", "username")
    SELECT "active", "createdAt", "disabledAt", "id", "passwordHash",
           CASE WHEN "role" = 'participant' THEN 'examiner' ELSE "role" END,
           "updatedAt", "username"
    FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_active_idx" ON "User"("active");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Safety net: convert any 'participant' row that could not be reached above
-- (e.g. a row inserted between the rebuild steps). Idempotent, no-op normally.
UPDATE "User" SET "role" = 'examiner' WHERE "role" = 'participant';
