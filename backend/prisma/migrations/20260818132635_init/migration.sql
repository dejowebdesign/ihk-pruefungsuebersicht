-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sheetsDetected" INTEGER NOT NULL DEFAULT 0,
    "sheetsImported" INTEGER NOT NULL DEFAULT 0,
    "sheetFailures" INTEGER NOT NULL DEFAULT 0,
    "dataRecords" INTEGER NOT NULL DEFAULT 0,
    "ihkLocations" INTEGER NOT NULL DEFAULT 0,
    "questions" INTEGER NOT NULL DEFAULT 0,
    "caseExamples" INTEGER NOT NULL DEFAULT 0,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "snapshotVersion" TEXT
);

-- CreateTable
CREATE TABLE "Sheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "gid" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sheetType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "orderIndex" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "colCount" INTEGER NOT NULL DEFAULT 0,
    "headers" TEXT NOT NULL,
    "rawRowsJson" TEXT NOT NULL,
    "parsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sheet_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IhkLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "sourceSheetId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "nr" INTEGER,
    "ihkShortName" TEXT NOT NULL,
    "officialName" TEXT,
    "skp" TEXT,
    "bundesland" TEXT,
    "writtenForm" TEXT,
    "writtenResultImmediate" TEXT,
    "sameDay" TEXT,
    "intervalWrittenOral" TEXT,
    "examinerCount" TEXT,
    "groupFormat" TEXT,
    "fallbeispiel" TEXT,
    "koFallbeispiel" TEXT,
    "punktesystem" TEXT,
    "vorbereitung" TEXT,
    "notizen" TEXT,
    "dataState" TEXT,
    "lastUpdatedRaw" TEXT,
    "bezirk" TEXT,
    "adresse" TEXT,
    "telefon" TEXT,
    "website" TEXT,
    "ansprechpartner" TEXT,
    "durchwahl" TEXT,
    "email" TEXT,
    "routeUrl" TEXT,
    CONSTRAINT "IhkLocation_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IhkLocation_sourceSheetId_fkey" FOREIGN KEY ("sourceSheetId") REFERENCES "Sheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "sourceSheetId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "ihkLocationId" TEXT,
    "masterId" TEXT,
    "category" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "legalBasis" TEXT,
    "difficulty" TEXT,
    "cluster" TEXT,
    "followUp1" TEXT,
    "followUp2" TEXT,
    "extraCol" TEXT,
    CONSTRAINT "Question_sourceSheetId_fkey" FOREIGN KEY ("sourceSheetId") REFERENCES "Sheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Question_ihkLocationId_fkey" FOREIGN KEY ("ihkLocationId") REFERENCES "IhkLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseExample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "sourceSheetId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "ihkLocationId" TEXT,
    "masterId" TEXT,
    "category" TEXT,
    "scenario" TEXT NOT NULL,
    "perfectAnswer" TEXT,
    "legalBasis" TEXT,
    "difficulty" TEXT,
    "cluster" TEXT,
    "followUp1" TEXT,
    "answer1" TEXT,
    "followUp2" TEXT,
    "answer2" TEXT,
    CONSTRAINT "CaseExample_sourceSheetId_fkey" FOREIGN KEY ("sourceSheetId") REFERENCES "Sheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseExample_ihkLocationId_fkey" FOREIGN KEY ("ihkLocationId") REFERENCES "IhkLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IhkRawRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowJson" TEXT NOT NULL,
    CONSTRAINT "IhkRawRow_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IhkSemantics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "ihkLocationId" TEXT,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "sourceRowNumber" INTEGER,
    CONSTRAINT "IhkSemantics_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IhkSemantics_ihkLocationId_fkey" FOREIGN KEY ("ihkLocationId") REFERENCES "IhkLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sheetName" TEXT,
    "rowId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ihkLocationId" TEXT,
    "questionId" TEXT,
    "caseExampleId" TEXT,
    CONSTRAINT "ChangeRecord_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeRecord_ihkLocationId_fkey" FOREIGN KEY ("ihkLocationId") REFERENCES "IhkLocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeRecord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeRecord_caseExampleId_fkey" FOREIGN KEY ("caseExampleId") REFERENCES "CaseExample" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImportRun_status_idx" ON "ImportRun"("status");

-- CreateIndex
CREATE INDEX "ImportRun_startedAt_idx" ON "ImportRun"("startedAt");

-- CreateIndex
CREATE INDEX "Sheet_gid_idx" ON "Sheet"("gid");

-- CreateIndex
CREATE INDEX "Sheet_sheetType_idx" ON "Sheet"("sheetType");

-- CreateIndex
CREATE UNIQUE INDEX "Sheet_importRunId_originalName_key" ON "Sheet"("importRunId", "originalName");

-- CreateIndex
CREATE UNIQUE INDEX "IhkLocation_ihkShortName_key" ON "IhkLocation"("ihkShortName");

-- CreateIndex
CREATE INDEX "IhkLocation_bundesland_idx" ON "IhkLocation"("bundesland");

-- CreateIndex
CREATE INDEX "IhkLocation_ihkShortName_idx" ON "IhkLocation"("ihkShortName");

-- CreateIndex
CREATE INDEX "IhkLocation_sourceSheetId_idx" ON "IhkLocation"("sourceSheetId");

-- CreateIndex
CREATE INDEX "Question_sourceSheetId_idx" ON "Question"("sourceSheetId");

-- CreateIndex
CREATE INDEX "Question_ihkLocationId_idx" ON "Question"("ihkLocationId");

-- CreateIndex
CREATE INDEX "CaseExample_sourceSheetId_idx" ON "CaseExample"("sourceSheetId");

-- CreateIndex
CREATE INDEX "CaseExample_ihkLocationId_idx" ON "CaseExample"("ihkLocationId");

-- CreateIndex
CREATE INDEX "IhkRawRow_sheetId_rowIndex_idx" ON "IhkRawRow"("sheetId", "rowIndex");

-- CreateIndex
CREATE INDEX "IhkSemantics_ihkLocationId_idx" ON "IhkSemantics"("ihkLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "IhkSemantics_sheetId_field_key" ON "IhkSemantics"("sheetId", "field");

-- CreateIndex
CREATE INDEX "ChangeRecord_importRunId_idx" ON "ChangeRecord"("importRunId");

-- CreateIndex
CREATE INDEX "ChangeRecord_entityType_entityId_idx" ON "ChangeRecord"("entityType", "entityId");
