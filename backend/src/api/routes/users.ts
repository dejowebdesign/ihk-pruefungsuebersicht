// User management — mounted under /api/users. Administrators only (enforced
// both by the central access policy and by requireAdmin here).
//
// All responses use the public user shape; `passwordHash` is never selected,
// let alone serialized.

import { Hono } from "hono";
import { prisma } from "../../db/prisma";
import { apiError } from "../helpers";
import { requireAdmin, type AuthVariables } from "../identity";
import {
  createUser,
  listUsers,
  getUser,
  setPassword,
  setActive,
  setRole,
  removeUser,
  isRole,
} from "../../auth/service";

export const users = new Hono<{ Variables: AuthVariables }>();

users.use("*", requireAdmin);

users.get("/", async (c) => {
  return c.json({ data: await listUsers(prisma()) });
});

users.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }
  // The role is taken from the admin-supplied body but validated against the
  // fixed role list — never trusted as a free-form string.
  const role = isRole(body.role) ? body.role : "participant";
  try {
    const user = await createUser(prisma(), {
      username: String(body.username ?? ""),
      password: String(body.password ?? ""),
      role,
    });
    return c.json({ user }, 201);
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not create user");
  }
});

users.get("/:id", async (c) => {
  const user = await getUser(prisma(), c.req.param("id"));
  if (!user) return apiError(c, 404, "user not found");
  return c.json({ user });
});

users.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    return apiError(c, 400, "invalid JSON body");
  }

  const existing = await getUser(prisma(), id);
  if (!existing) return apiError(c, 404, "user not found");

  try {
    if (body.password !== undefined) {
      await setPassword(prisma(), id, String(body.password));
    }
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") return apiError(c, 400, "active must be a boolean");
      await setActive(prisma(), id, body.active);
    }
    if (body.role !== undefined) {
      if (!isRole(body.role)) return apiError(c, 400, "invalid role");
      await setRole(prisma(), id, body.role);
    }
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not update user");
  }

  return c.json({ user: await getUser(prisma(), id) });
});

/**
 * Deactivation, not a hard delete: exams, ratings and history stay intact and
 * the last active administrator can never be removed.
 */
users.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await getUser(prisma(), id))) return apiError(c, 404, "user not found");
  try {
    const user = await removeUser(prisma(), id);
    return c.json({ user });
  } catch (e) {
    return apiError(c, 400, e instanceof Error ? e.message : "could not deactivate user");
  }
});
