// Health endpoint — suitable for Docker healthcheck.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { APP_VERSION } from "../helpers";

export const health = new Hono();

health.get("/", async (c) => {
  let db: "ok" | "error" = "ok";
  try {
    await prisma().$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  const status = db === "ok" ? "ok" : "error";
  return c.json({
    status,
    database: db,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  });
});
