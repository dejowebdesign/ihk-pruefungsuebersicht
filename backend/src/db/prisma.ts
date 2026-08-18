import { PrismaClient } from "@prisma/client";

let _client: PrismaClient | null = null;

/** Singleton Prisma client for the whole backend process. */
export function prisma(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient({
      log: process.env.NODE_ENV === "test" ? ["error"] : ["warn", "error"],
    });
  }
  return _client;
}

/** For tests: use an isolated in-memory/file db via DATABASE_URL override. */
export function setPrismaClient(client: PrismaClient): void {
  _client = client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
