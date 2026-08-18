// Test helpers: create an isolated SQLite DB, push the schema, return a client.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { setPrismaClient, disconnectPrisma } from "../../src/db/prisma";

let counter = 0;

export async function makeIsolatedDb(): Promise<{
  client: PrismaClient;
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const dbPath = path.join(os.tmpdir(), `ihk-test-${Date.now()}-${counter++}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;

  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env },
  });

  const client = new PrismaClient();
  setPrismaClient(client);
  return {
    client,
    dbPath,
    cleanup: async () => {
      await disconnectPrisma();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    },
  };
}

/** Build a minimal valid SheetJson-like input with the given overview rows. */
export function overviewSheet(rows: (unknown | null)[][]) {
  // Übersicht column layout (37 cols). Pad rows to 37 cols.
  const padded = rows.map((r) => {
    const p = [...r];
    while (p.length < 37) p.push(null);
    return p;
  });
  return {
    sheetName: "Übersicht",
    gid: "0",
    sheetId: "test",
    source: "test",
    cols: [],
    headers: Array(37).fill(null),
    rows: padded,
    numRows: padded.length,
    numCols: 37,
    parsedNumHeaders: 1,
    warnings: null,
    errors: null,
  };
}

/** Build a minimal Master_Fragen_Muendlich sheet with the given question rows. */
export function questionsSheet(rows: (unknown | null)[][]) {
  const padded = rows.map((r) => {
    const p = [...r];
    while (p.length < 10) p.push(null);
    return p;
  });
  return {
    sheetName: "Master_Fragen_Muendlich",
    gid: "765582598",
    sheetId: "test",
    source: "test",
    cols: [],
    headers: [
      "ID",
      "Kategorie",
      "Frage",
      "Prüferantwort",
      "Rechtslehre",
      "Schwierigkeit",
      "Cluster",
      "Folgefrage 1",
      "Folgefrage 2",
      "Spalte 4",
    ],
    rows: padded,
    numRows: padded.length,
    numCols: 10,
    parsedNumHeaders: 1,
    warnings: null,
    errors: null,
  };
}
