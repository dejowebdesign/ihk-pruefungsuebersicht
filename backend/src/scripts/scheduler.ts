// CLI: start the import scheduler (runs until killed).
// Usage: npm run scheduler:start
import { startScheduler } from "../scheduler/scheduler";
import { disconnectPrisma } from "../db/prisma";

async function main() {
  startScheduler();
  console.log("Scheduler running. Press Ctrl+C to stop.");
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await disconnectPrisma();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await disconnectPrisma();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
