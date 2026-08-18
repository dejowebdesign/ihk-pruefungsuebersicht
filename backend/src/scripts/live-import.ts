// CLI: trigger a one-off live import from Google Sheets via gviz.
// Usage: npm run import:live
import { runLiveImport } from "../importer/live-import";
import { disconnectPrisma } from "../db/prisma";

async function main() {
  console.log("Starting live gviz import...");
  const result = await runLiveImport();
  console.log("\n=== Live import result ===");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "FAILED") {
    process.exitCode = 1;
  }
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
