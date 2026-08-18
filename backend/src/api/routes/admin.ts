// Admin endpoints (protected by adminAuth): manual import trigger, scheduler
// status, and a combined admin status. All return JSON, never raw exceptions.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { adminAuth } from "../admin-auth";
import { triggerImport, schedulerStatus } from "../../scheduler/scheduler";
import { apiError } from "../helpers";

export const admin = new Hono();

// All admin routes require the shared secret.
admin.use("*", adminAuth);

// GET /api/admin/status — import status + scheduler in one call.
admin.get("/status", async (c) => {
  const db = prisma();
  const lastSuccess = await db.importRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
  const lastAttempt = await db.importRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  const sched = await schedulerStatus();
  return c.json({
    lastSuccess: lastSuccess
      ? {
          id: lastSuccess.id,
          startedAt: lastSuccess.startedAt,
          finishedAt: lastSuccess.finishedAt,
          sheetsImported: lastSuccess.sheetsImported,
          changeCount: lastSuccess.changeCount,
        }
      : null,
    lastAttempt: lastAttempt
      ? {
          id: lastAttempt.id,
          status: lastAttempt.status,
          startedAt: lastAttempt.startedAt,
          finishedAt: lastAttempt.finishedAt,
          lastError: lastAttempt.errors,
        }
      : null,
    scheduler: sched,
  });
});

// GET /api/admin/scheduler — scheduler state only.
admin.get("/scheduler", async (c) => {
  return c.json(await schedulerStatus());
});

// POST /api/admin/import — trigger a manual import (mutex-guarded).
admin.post("/import", async (c) => {
  const result = await triggerImport();
  // triggerImport either returns the ImportResult or {skipped:true,...}
  if ("skipped" in result) {
    return c.json({ status: "skipped", reason: result.reason }, 409);
  }
  const status =
    result.status === "SUCCESS" ? 200 : result.status === "PARTIAL" ? 207 : 500;
  return c.json(result, status as 200 | 207 | 500);
});
