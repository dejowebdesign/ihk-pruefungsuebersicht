// CLI entry: run the initial snapshot import.
// Usage: npm run import:initial
import { runInitialImport } from "../importer/initial-import";
import { disconnectPrisma } from "../db/prisma";

async function main() {
  console.log("Starting initial snapshot import...");
  const result = await runInitialImport();
  console.log("\n=== Import result ===");
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
