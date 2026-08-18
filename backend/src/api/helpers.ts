// Shared API helpers: pagination, safe JSON error responses (no stacktraces),
// and the "latest successful ImportRun" scope used by all public endpoints.

import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(c: Context): Pagination {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limitReq = Number(c.req.query("limit") ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, limitReq), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, p: Pagination) {
  return {
    data: items,
    pagination: {
      page: p.page,
      limit: p.limit,
      total,
      totalPages: Math.ceil(total / p.limit) || 1,
    },
  };
}

/**
 * Resolve the most recent SUCCESSFUL ImportRun. All public read endpoints scope
 * their queries to this run so they never expose stale/orphaned data. Returns
 * null when no successful import has happened yet.
 */
export async function latestSuccessRun(db: PrismaClient) {
  return db.importRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
}

/** Generic error responder — never leaks internal details. */
export function apiError(c: Context, status: number, message: string) {
  return c.json({ error: message }, status);
}

/** Coerce a query param to a trimmed string or null. */
export function qStr(c: Context, key: string): string | null {
  const v = c.req.query(key);
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export const APP_VERSION = "0.4.0";
