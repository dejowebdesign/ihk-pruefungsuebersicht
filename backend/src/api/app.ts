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

export function createApp() {
  const app = new Hono();
  app.use("*", logger());

  app.route("/api/health", health);
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
      version: "0.4.0",
      endpoints: [
        "GET /api/health",
        "GET /api/ihk",
        "GET /api/ihk/search?q=...",
        "GET /api/ihk/:id",
        "GET /api/sheets",
        "GET /api/sheets/:id",
        "GET /api/questions",
        "GET /api/questions/:id",
        "GET /api/case-examples",
        "GET /api/case-examples/:id",
        "GET /api/import/status",
        "GET /api/import/runs",
        "GET /api/admin/status (auth)",
        "GET /api/admin/scheduler (auth)",
        "POST /api/admin/import (auth)",
        "GET /api/oral/pool",
        "GET /api/oral/themes",
        "GET /api/oral/exams",
        "GET /api/oral/exams/:id",
        "GET /api/oral/exams/:id/score",
        "POST /api/oral/exams (auth)",
        "PATCH /api/oral/exams/:id/questions/:order (auth)",
        "POST /api/oral/exams/:id/complete (auth)",
        "PATCH /api/oral/exams/:id (auth)",
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
