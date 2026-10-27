// API app composition. Mounts all routers under /api and adds global error
// handling (no stacktraces leaked to clients).

import { Hono } from "hono";
import { logger } from "hono/logger";
import { health } from "./routes/health";
import { ihk } from "./routes/ihk";
import { sheets } from "./routes/sheets";
import { questions } from "./routes/questions";
import { caseExamples } from "./routes/case-examples";
import { imp } from "./routes/import";
import { admin } from "./routes/admin";
import { oral } from "./routes/oral";
import { auth } from "./routes/auth";
import { users } from "./routes/users";
import { attachIdentity, resolveIdentity, type AuthVariables } from "./identity";
import { requiredAccess } from "./access-policy";

export function createApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", logger());
  // Resolve the caller once per request (DB-backed session or legacy token).
  app.use("*", attachIdentity);

  // Central server-side gate. Every route declares a minimum access level in
  // access-policy.ts; an examiner cannot reach an admin-only endpoint even by
  // calling it directly, and the role is never taken from request data.
  app.use("/api/*", async (c, next) => {
    const need = requiredAccess(c.req.method, new URL(c.req.url).pathname);
    if (need === "public") return next();

    const identity = c.get("identity") ?? (await resolveIdentity(c));
    if (!identity) return c.json({ error: "unauthorized" }, 401);
    if (need === "admin" && identity.role !== "admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  });

  app.route("/api/health", health);
  app.route("/api/auth", auth);
  app.route("/api/users", users);
  app.route("/api/ihk", ihk);
  app.route("/api/sheets", sheets);
  app.route("/api/questions", questions);
  app.route("/api/case-examples", caseExamples);
  app.route("/api/import", imp);
  app.route("/api/admin", admin);
  app.route("/api/oral", oral);

  app.get("/api", (c) =>
    c.json({
      name: "IHK Prüfungsübersicht API",
      version: "0.5.0",
      endpoints: [
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "GET /api/health",
        "GET /api/ihk (auth — backs the start page)",
        "GET /api/ihk/search?q=... (public)",
        "GET /api/ihk/:id (auth — IHK detail page)",
        "GET /api/sheets (admin)",
        "GET /api/sheets/:id (admin)",
        "GET /api/questions (admin)",
        "GET /api/questions/:id (admin)",
        "GET /api/case-examples (admin)",
        "GET /api/case-examples/:id (admin)",
        "GET /api/import/status (admin)",
        "GET /api/import/runs (admin)",
        "GET /api/admin/status (admin)",
        "GET /api/admin/scheduler (admin)",
        "POST /api/admin/import (admin)",
        "GET /api/users (admin)",
        "POST /api/users (admin)",
        "GET /api/users/:id (admin)",
        "PATCH /api/users/:id (admin)",
        "DELETE /api/users/:id (admin)",
        "GET /api/oral/pool (auth)",
        "GET /api/oral/themes (auth)",
        "GET /api/oral/exams (auth, all exams)",
        "GET /api/oral/exams/:id (auth)",
        "GET /api/oral/exams/:id/score (auth)",
        "GET /api/oral/exams/:id/pdf (auth, completed only)",
        "POST /api/oral/exams (staff)",
        "PATCH /api/oral/exams/:id/questions/:order (staff)",
        "POST /api/oral/exams/:id/complete (staff)",
        "PATCH /api/oral/exams/:id (staff)",
        "DELETE /api/oral/exams/:id?confirm=true (staff)",
      ],
    }),
  );

  app.all("*", (c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    console.error("Unhandled API error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
