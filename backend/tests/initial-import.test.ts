import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runInitialImport } from "../src/importer/initial-import";
import type { ImportResult } from "../src/importer/initial-import";
import { setPrismaClient, disconnectPrisma } from "../src/db/prisma";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let dbPath: string;
let shared: ImportResult;
let client: PrismaClient;

beforeAll(async () => {
  // Isolated SQLite file for this test run.
  dbPath = path.join(os.tmpdir(), `ihk-test-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  client = new PrismaClient();
  setPrismaClient(client);
  // Push schema into the empty SQLite db.
  const { execSync } = await import("node:child_process");
  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env },
  });
  // Re-bind client after db push reset.
  await client.$disconnect();
  client = new PrismaClient();
  setPrismaClient(client);

  // Run the import ONCE; all tests assert against this shared result.
  shared = await runInitialImport();
}, 180_000);

afterAll(async () => {
  await disconnectPrisma();
  if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe("initial import (snapshot -> SQLite)", () => {
  it("imports all 85 sheets successfully", () => {
    expect(shared.status).toBe("SUCCESS");
    expect(shared.sheetsDetected).toBe(85);
    expect(shared.sheetsImported).toBe(85);
    expect(shared.sheetFailures).toBe(0);
  });

  it("creates 82 IHK locations from Übersicht", () => {
    expect(shared.ihkLocations).toBe(82);
  });

  it("imports 244 questions (regression)", () => {
    expect(shared.questions).toBe(244);
  });

  it("imports 30 case examples", () => {
    expect(shared.caseExamples).toBe(30);
  });

  it("preserves raw rows for every sheet", () => {
    expect(shared.rawRows).toBeGreaterThan(3250); // ~3259 total data rows
  });

  it("creates an ImportRun with SUCCESS status", async () => {
    expect(shared.importRunId).toBeTruthy();
    const run = await client.importRun.findUnique({ where: { id: shared.importRunId! } });
    expect(run?.status).toBe("SUCCESS");
    expect(run?.sheetsImported).toBe(85);
  });

  it("persists 85 Sheet rows with raw JSON preserved", async () => {
    const count = await client.sheet.count();
    expect(count).toBe(85);
    const aachen = await client.sheet.findFirst({ where: { originalName: "Aachen" } });
    expect(aachen).toBeTruthy();
    expect(aachen!.headers).toBeTruthy();
    expect(aachen!.rawRowsJson).toBeTruthy();
    expect(JSON.parse(aachen!.rawRowsJson)).toBeInstanceOf(Array);
  });

  it("persists IhkRawRow for every data row", async () => {
    const total = await client.ihkRawRow.count();
    expect(total).toBe(3259);
  });

  it("links IhkSemantics to the right IHK location", async () => {
    const aachenLoc = await client.ihkLocation.findUnique({ where: { ihkShortName: "Aachen" } });
    expect(aachenLoc).toBeTruthy();
    const sem = await client.ihkSemantics.findMany({
      where: { ihkLocationId: aachenLoc!.id },
    });
    expect(sem.length).toBeGreaterThan(0);
    const fields = sem.map((s) => s.field);
    expect(fields).toContain("Medium");
  });
});
