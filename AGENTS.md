# IHK Prüfungsübersicht — Agent Notes

Standalone GitHub project (`ihk-pruefungsuebersicht`). Independent of Quiz0r — do
NOT modify Quiz0r.

## Architecture

- **backend/** — Hono REST API (read-only) on Prisma + SQLite. Tests via Vitest
  (`npm -w backend test`, 265 tests). Start: `npm -w backend run serve` with
  `DATABASE_URL`, `ADMIN_TOKEN`, `PORT` env. The `serve` script defaults to
  PORT=3000, so set `PORT=3001` to match docker-compose/`BACKEND_URL`.
- **frontend/** — Next.js 14 (App Router) Web-GUI consuming the backend API.
- **Dockerfile** (root) — backend image. **frontend/Dockerfile** — Next.js image.

## Phase 9 — Auth, user management, exam admin & PDF (DONE)

### Authentication & roles
- **DB-backed session cookie auth** (`ihk_session`), replacing the old
  `frontend/src/lib/oral-auth.ts` localStorage admin-token flow (deleted) and
  `backend/src/api/admin-auth.ts` (deleted). Roles: `admin` | `participant`.
- Password hashing: **scrypt via `node:crypto`** (`backend/src/auth/passwords.ts`),
  format `scrypt$N$r$p$<saltHex>$<hashHex>` (self-describing, params readable at
  verify time). **No new dependencies** — deliberately hand-rolled.
- Sessions: raw token lives only in the httpOnly cookie; DB stores only its
  SHA-256 (`backend/src/auth/service.ts`). `active` is re-checked on *every*
  request, so deactivation is immediate; sessions are revocable.
- **Legacy `ADMIN_TOKEN` is preserved**: a Bearer token still authenticates as
  `admin` (`backend/src/api/identity.ts`), so existing tooling keeps working.
  `bootstrapAdmin()` (run in `scripts/serve.ts`) creates the `admin` account once
  from `ADMIN_PASSWORD` (else `ADMIN_TOKEN`) and is a no-op once any admin
  exists — restarting never overwrites a password changed in the UI.
- **Last active admin is protected** in the service layer (not the UI):
  `setActive`/`setRole`/`removeUser` refuse to deactivate/demote the final admin.

### Authorization model (two layers, both server-side)
1. **Central gate** — `backend/src/api/access-policy.ts` `requiredAccess(method, path)`
   returns `public` | `authenticated` | `admin` for every API path; wired as
   `app.use("/api/*", …)` in `app.ts`. A participant cannot reach an admin-only
   endpoint even when the UI is bypassed. Unknown paths resolve to `public` so
   they 404 normally instead of a misleading 401.
   - Public: `/api`, `/api/health`, `/api/auth/*`, legacy `/api/admin/*`, and
     `/api/ihk` + `/api/ihk/search` (they back the participant start page `/`).
   - Admin-only: `/api/ihk/:id` (detail), `/questions`, `/case-examples`,
     `/sheets`, `/import`, `/users`, and every non-GET `/api/oral/*`.
   - `/api/oral/*` GETs: `authenticated`.
2. **Route guards** — `requireAdmin` / `requireAuth` / `adminGuard`
   (`backend/src/api/identity.ts`). Roles are **never** read from request data:
   exam ownership is taken from the session (`identity.userId`), and a `userId`
   in a request body is ignored.

### Participant scoping
- Participants may only read exams whose `userId` equals their own; the filter is
  applied **in the SQL `where`** (`examScope()` in `routes/oral.ts`), not by
  post-filtering. A foreign exam returns **404, not 403**, so its existence is
  not confirmed. Exams with `userId = null` (legacy/admin-token-created) are
  never participant-readable.
- `frontend/src/middleware.ts` gates pages server-side (participant: `/` and
  `/muendliche-pruefung*` only; everything else redirects to `/`). `/login` is
  public and bounces signed-in users onward.

### PDF report (`backend/src/oral/pdf.ts` + `pdf-writer.ts`)
- Hand-rolled PDF writer, **no dependencies**. Text ops are `BT /F1|F2 <size> Tf
  … Tm (…) Tj ET`; streams are **uncompressed** (do not assume Flate). Umlauts
  (ä/ö/ü/ß/§) render via Helvetica WinAnsiEncoding, so no font file is embedded.
- The report is a **pure renderer of persisted values** (`maxPoints`,
  `totalPoints`, `percent`, `result`, plus stored per-item `rating`/`points`/
  `weight` snapshots). It never re-runs scoring, so it cannot disagree with the
  app — including historical exams whose weights were snapshotted under an older
  theme layout. Percent uses the same `Math.round` as the UI.
- `GET /api/oral/exams/:id/pdf` → 404 unknown, **409 not-completed**, 200 with
  `Content-Disposition: inline|attachment` (`?disposition=attachment`) and
  `Cache-Control: private, no-store`.

### Exam deletion
- `DELETE /api/oral/exams/:id` is admin-only and requires explicit confirmation
  (`?confirm=true` or `x-confirm-delete: true`), else **400**. `deleteExam()`
  (`oral/service.ts`) runs in one transaction: deletes the exam's
  `OralExamQuestion` rows, then the exam, then the candidate **only if orphaned**.
  The question pool (`OralQuestion`/`OralTheme`) is never touched, and a candidate
  shared with another exam is kept. Unknown id → 404 with no write.

### Gotchas
- **`content-length` must not be forwarded by the API proxy.** Re-reading the body
  while passing the original framing headers makes undici throw
  `RequestContentLengthMismatchError` → 502 on every DELETE. `middleware.ts`
  deletes `content-length`/`transfer-encoding` before forwarding.
  Covered by `frontend/tests/middleware.test.ts`.
- `next start` warns under `output: "standalone"`; the warning is expected.
- Frontend identity cache (`src/lib/auth.ts`) is **observable** (subscribe/notify):
  without it a client-side login leaves the already-mounted `Header` stale.
- Migrations are **additive**: `20260827000000_users_sessions` adds `User`/
  `Session`, adds nullable `OralExam.userId` (ON DELETE SET NULL), and preserves
  every existing row/result.

## Phase 5 (Next.js Web-GUI) key learnings

- **Next.js 14 path alias:** add `jsconfig.json` mirroring tsconfig `paths`.
  Next 14's webpack alias resolution reads jsconfig even in TS projects.
- **Next 14 `params`:** synchronous `function Page({ params }: { params: { id: string } })`.
  Do NOT use the `use(params)` Promise pattern (that is Next 15).
- **TypeScript:** pin `typescript@5.4.5` locally. TS 7.x causes Next worker errors.
- **Viewport metadata:** export `viewport` separately from `metadata` in layout.
- **API proxy at runtime:** use `src/middleware.ts` (reads `process.env.BACKEND_URL`
  at request time), NOT `next.config.js` `rewrites()` — rewrites are baked into
  the build and prevent runtime backend-URL configuration (critical for Docker).
  The matcher is `/api/:path*`.
- **`output: "standalone"`** in `next.config.js` for self-contained Docker images.
  When built as an npm workspace, standalone output lives in `.next/standalone/`
  (not in a `frontend/` subdir) — see `frontend/Dockerfile` COPY steps.

## Frontend testing stack (Vitest)

- `vitest@1.6.1` + `@vitejs/plugin-react` (loaded via dynamic import in
  `vitest.config.mjs` because plugin-react is ESM-only and vitest 1.x config is
  CJS-loaded — `.mjs` + top-level `await import()` avoids the esbuild ESM error).
- `@testing-library/jest-dom` must be **6.x** for vitest 1.x. jest-dom 7.x
  requires vitest ≥2 and throws "Cannot set property testPath of #<Object>".
- `esbuild.jsx: "automatic"` in vitest config so `.tsx` test files don't need
  `import React` (component source files have no explicit React import).
- **userEvent + fake timers hang** (userEvent waits internally). Use real timers
  for interactive tests; for debounce use a small `debounceMs` + `setTimeout`.
- Run: `npx vitest run` (172 tests across 15 suites, all passing).

## Commands

```bash
# Backend
npm -w backend test
DATABASE_URL="file:$PWD/backend/prisma/dev.db" ADMIN_TOKEN=tok PORT=3001 npm -w backend run serve

# Frontend
npm -w frontend test        # or: cd frontend && npx vitest run
npm -w frontend run build
npm -w frontend run dev
```

## Docker

`docker-compose up --build` builds `ihk-api` (port 12001) + `ihk-web` (port
12000). `ihk-web` depends on `ihk-api` (healthy) and proxies `/api` via
`BACKEND_URL=http://ihk-api:3001`.

## Phase 8 — Oral exam ("Mündliche Prüfung") spec (from Excel reference)

Source workbook: `Pruefungsmatrix_muendliche_Pruefung_34a_vereinfacht_mit_Antworten.xlsx`
(6 sheets: Pruefung, Auswertung, Prueflinge, Automatische Fragen, Fragenpool,
Anleitung). The workbook is a **template only** — not read at runtime. Its data
is seeded into the app DB via a seed script; the public `/fragen` questions
(Master_Fragen_Muendlich) are a DIFFERENT pool and must stay separate.

### Exam structure (Excel base + X2/W1 extension — 2026)
- **13 questions per exam.** Base = **exactly one question per each of the
  9 Themenbereiche** (order preserved, orderKey 1..9). Plus **4 additional
  questions over 4 DISTINCT of the remaining 8 themes** (orderKey 10..13).
  **UVV/DGUV never receives a 2nd question** (exactly one UVV question per exam).
  **No Themenbereich has more than 2 questions.**
- The first 8 Themenbereiche + order come from the Excel workbook (Pruefung rows
  8–15); the 9th (UVV/DGUV) was added as an independent Bereich.
- 9 Themenbereiche with weights (sum = 100 = Maximalpunkte), decision "W1":

| # | Themenbereich | weight |
|---|---------------|--------|
| 1 | Recht der oeffentlichen Sicherheit und Ordnung | 8 |
| 2 | Gewerberecht / Bewachungsverordnung | 12 |
| 3 | Buergerliches Gesetzbuch / Jedermannsrechte | 12 |
| 4 | Straf- und Verfahrensrecht | 12 |
| 5 | Umgang mit Waffen | 8 |
| 6 | Umgang mit Menschen / Deeskalation | 16 |
| 7 | Datenschutzrecht | 8 |
| 8 | Grundlagen der Sicherheitstechnik | 16 |
| 9 | Unfallverhuetungsvorschriften (UVV/DGUV) | 8 |

  Every weight is **divisible by 4**, so both `weight/2` (a theme with 2
  questions) and `weight/4` ("teilweise richtig" on a doubled theme) are exact
  integers → no rounding, Excel parity preserved.

### Fragenpool
- Excel "Fragenpool" sheet: 224 rows → 218 unique Frage-IDs. 6 duplicate rows are
  content-continuation fragments (BGB-02, Sicherheitstechnik-02, StGB-01,
  UmW-01×3, UmW-02) merged into the parent question during seeding.
- **2026 extension from `Fragen.txt`** (uploaded questions, 8 Themengebiete,
  146 questions): **123 new questions added** (341 total), **23 exact/content
  duplicates skipped** (existing questions never deleted or changed). New
  questions are numbered by appending to each theme's existing excelId prefix
  (e.g. `UmM-41`..`UmM-50`, new prefix `UVV-01`..`UVV-11`).
- Pool per theme (after extension): StGB 58, Sicherheitstechnik 53, UmM 50,
  BGB 44, Datenschutz 42, RdOesO 32, UmW 31, Gewerberecht 20, UVV 11.

### Grading logic (1:1 — DO NOT change)
- **3 Bewertungsstufen:** `richtig` / `teilweise richtig` / `falsch`.
- Per-question points (Pruefung!G8:G15):
  `=IF(F="","",IF(F="richtig",B,IF(F="teilweise richtig",B/2,0)))`
  → richtig = full weight; teilweise richtig = weight/2; falsch = 0.
- **All weights are divisible by 4**, so weight/2 (and weight/4 for a doubled
  theme) is always an exact integer — no per-question rounding ambiguity.
- **Maximalpunkte** (G17) = 100. **Summe** (G18) = `SUM(G8:G15)`.
- **Prozentwert** (G19) = `G18/G17` = points/100. Format `0.0%` → display
  with one decimal (e.g. "78.0 %"). Underlying value is exact (integer/100).
- **Bestehensstatus** (G20) = `IF(G18>=50,"Bestanden","Nicht bestanden")`.
  Anleitung R7 confirms: "Ab 50 Punkten zeigt die Matrix bestanden an."
- Number formats: per-question & sum `0.0`; percent `0.0%`. These are
  display-only in Excel; the stored values are full precision. Because all
  inputs are integers, computation needs NO rounding; percent = points exactly.

### Randomization (the ONLY deliberate change vs. Excel)
- Excel fixes a specific question per Prüfling; the app draws a **fresh random
  question per theme** for each NEW exam (1 from each of the 9 themes in order,
  plus 4 extra questions over 4 distinct non-UVV themes; ≤2 per theme; no
  duplicate question-ids within an exam).
- The concrete selection (ids + order + per-question weights) is **persisted**
  on exam creation and never regenerated (reload/reopen/continue keep the same
  questions). Existing exams keep their stored `themeName`/`weight` snapshots —
  they are NOT recomputed when the pool or weights change.

### Luna transfer
- Only the **single overall percent** is needed — not per-theme breakdowns.
  Copy button copies exactly `NN %` (the overall percent), nothing else.

### Implementation (Phase 8 — DONE; 13-question/9-theme extension — DONE)
- **Backend** (`backend/src/oral/`): `themes.ts` (9 themes + weights, `ORAL_QUESTIONS_PER_EXAM = 13`, `ORAL_EXTRA_QUESTIONS = 4`, `ORAL_UVV_THEME`),
  `scoring.ts` (Excel G8–G20 parity: `questionPoints`, `totalPoints`,
  `percentValue` via `total*100/max` to avoid IEEE-754 artefacts, `passResult`,
  `scoreExam`), `randomize.ts` (`mulberry32` seeded RNG, `drawExam` → 13 slots:
  9 base in theme order + 4 extras over distinct non-UVV themes, `groupByTheme`,
  avoid-set for consecutive exams), `seed.ts` (idempotent upsert of 9 themes +
  341 questions from JSON), `service.ts` (`createExam`/`rateQuestion`/`completeExam`/`getExam` — atomic
  persistence, immutable question set, auto-recompute on every rating; `maxPoints`
  derived from `ORAL_TOTAL_WEIGHT` = 100).
- **API** (`backend/src/api/routes/oral.ts`): public `GET /themes`, `GET /pool`,
  `GET /exams`, `GET /exams/:id`, `GET /exams/:id/score`; auth-gated
  `POST /exams`, `PATCH /exams/:id/questions/:order` (order validated 1..13),
  `POST /exams/:id/complete`, `PATCH /exams/:id`, `POST /seed`. Registered in `app.ts`.
- **Schema** (`backend/prisma/schema.prisma`): `OralTheme`, `OralQuestion`,
  `OralCandidate` (name `@unique` for upsert), `OralExam`, `OralExamQuestion`.
  Migration `20260819000000_oral_exam` (also reconciles a pre-existing
  `IhkLocation` index drift). Seed JSON: `backend/prisma/seed/oral-questions.json`.
  Seeder entrypoint: `backend/src/scripts/seed-oral.ts`
  (`DATABASE_URL=file:… npx tsx src/scripts/seed-oral.ts`).
- **Frontend**: nav link "Mündliche Prüfung" in `Header.tsx`; page
  `/muendliche-pruefung` (list + new-exam form), page
  `/muendliche-pruefung/[id]` (take screen with progress, rating buttons,
  examiner note, live score; result screen with overall %, "Gesamtwert
  kopieren" copies exactly `NN %`, detailed table). Shares the admin token
  from `/admin` via `frontend/src/lib/oral-auth.ts`. Styles in `globals.css`
  (`.oral-*`) use theme tokens → light/dark automatic.
- **Tests**: `backend/tests/oral-scoring.test.ts` (30 Excel-parity cases),
  `oral-randomize.test.ts` (16: 13 questions, 9 themes, exactly 1 UVV, ≤2/theme,
  100 pts), `oral-service.test.ts` (24 incl. API+auth, 13-question persistence,
  50/100 threshold, historical exams unchanged), `frontend/tests/oral-parity.test.tsx`
  (12 incl. Luna copy). All green: backend 229, frontend 137, build ✓.
- **E2E verified** in-browser (pre-extension): create exam → rate questions →
  live % updates → complete → result screen → copy button → appears in list.
  Dark mode renders correctly.
- **Test-data note**: `Fragen.txt` (the 2026 question file) is NOT committed to
  the repo; only its parsed result is in the seed JSON. The uploaded file had
  line-continuation artefacts which were reassembled verbatim before import.

### Flagged original-text issues (kept verbatim — for later review)
Per the "no silent correction" rule, these were imported unchanged and flagged:
- `StGB-…` "Darf man einen 13-jährigen festhalten?" — answer grammar
  ("könne auch ihre Festnahme … nicht zulässig sein") left as-is.
- `StGB-…` "Was passiert bei Verletzung der Garantenstellung?" — awkward
  phrasing ("kann wegen Begehens durch Unterlassen bestraft werden") left as-is.
- Existing pool typos preserved (not touched): "Panikbegrice" (UmM-35),
  "Schusswa2en/Schusswa6en" (UmW), "Recht der oeffentlichen" naming, and
  Sicherheitstechnik-02 carrying an embedded continuation line.
