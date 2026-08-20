// HTTP server entrypoint. Reads PORT and optionally starts the scheduler.
// Usage: npm run serve
//        npm run serve -- --with-scheduler

import { serve } from "@hono/node-server";
import { createApp } from "../api/app";
import { maybeInitialImport, startScheduler, stopScheduler } from "../scheduler/scheduler";
import { ensureOralPoolSeeded } from "../oral/seed";
import { prisma, disconnectPrisma } from "../db/prisma";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const withScheduler = process.argv.includes("--with-scheduler");
  if (withScheduler) {
    startScheduler();
    // Bootstrap: populate the DB on a fresh deploy (no prior SUCCESS run) so
    // the API stops returning 503 without waiting up to 6h for the first tick.
    // Non-blocking — the HTTP server starts immediately and data appears once
    // the background import finishes.
    void maybeInitialImport().catch((e) =>
      console.error("Initial import failed:", e),
    );
  }

  // Bootstrap the oral-exam question pool BEFORE the HTTP listener starts.
  // A fresh deploy (empty SQLite volume) ships zero OralQuestion rows, which
  // would make "create oral exam" fail with "pool is empty — run seed first".
  // This is idempotent (counts first; upserts only on an empty/partial pool)
  // and never touches existing exams/ratings, so repeated restarts are safe.
  // Runs unconditionally (not gated on --with-scheduler) because oral exams
  // are a core feature available on every deployment, scheduler or not.
  try {
    const r = await ensureOralPoolSeeded(prisma());
    if (r.seeded) {
      console.log(`Oral question pool seeded: ${r.themes} themes, ${r.questions} questions`);
    }
  } catch (e) {
    // Never block startup: a transient DB error defers to the next start,
    // matching the maybeInitialImport philosophy. OralExam creation will
    // surface a clear error until the pool is available.
    console.error("Oral pool self-seed failed:", e);
  }

  const app = createApp();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`IHK Prüfungsübersicht API listening on http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    console.log("\nShutting down...");
    stopScheduler();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
