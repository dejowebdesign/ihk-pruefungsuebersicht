// HTTP server entrypoint. Reads PORT and optionally starts the scheduler.
// Usage: npm run serve
//        npm run serve -- --with-scheduler

import { serve } from "@hono/node-server";
import { createApp } from "../api/app";
import { startScheduler, stopScheduler } from "../scheduler/scheduler";
import { disconnectPrisma } from "../db/prisma";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const withScheduler = process.argv.includes("--with-scheduler");
  if (withScheduler) startScheduler();

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
