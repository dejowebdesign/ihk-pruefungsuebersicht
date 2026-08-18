// HTTP server entrypoint. Reads PORT and optionally starts the scheduler.
// Usage: npm run serve
//        npm run serve -- --with-scheduler

import { serve } from "@hono/node-server";
import { createApp } from "../api/app";
import { maybeInitialImport, startScheduler, stopScheduler } from "../scheduler/scheduler";
import { disconnectPrisma } from "../db/prisma";

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
