# IHK Prüfungsübersicht — Agent Notes

Standalone GitHub project (`ihk-pruefungsuebersicht`). Independent of Quiz0r — do
NOT modify Quiz0r.

## Architecture

- **backend/** — Hono REST API (read-only) on Prisma + SQLite. Tests via Vitest
  (`npm -w backend test`). Start: `npm -w backend run serve` with
  `DATABASE_URL`, `ADMIN_TOKEN` (and/or `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`
  for the login), `PORT` env. The `serve` script defaults to
  PORT=3000, so set `PORT=3001` to match docker-compose/`BACKEND_URL`.
- **frontend/** — Next.js 14 (App Router) Web-GUI consuming the backend API.
- **Dockerfile** (root) — backend image. **frontend/Dockerfile** — Next.js image.

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
- Run: `npx vitest run` (30 tests across 4 suites, all passing).

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

### Exam structure (1:1 from Excel)
- **8 questions per exam, exactly one per Themenbereich** (Pruefung rows 8–15,
  "Automatische Fragen" = 30 Prüflinge × 8 questions, INDEX offset `(nr-1)*8+k`).
- 8 Themenbereiche with fixed weights (sum = 100 = Maximalpunkte):

| # | Themenbereich | weight |
|---|---------------|--------|
| 1 | Recht der oeffentlichen Sicherheit und Ordnung | 10 |
| 2 | Gewerberecht / Bewachungsverordnung | 12 |
| 3 | Buergerliches Gesetzbuch / Jedermannsrechte | 14 |
| 4 | Straf- und Verfahrensrecht | 14 |
| 5 | Umgang mit Waffen | 8 |
| 6 | Umgang mit Menschen / Deeskalation | 18 |
| 7 | Datenschutzrecht | 8 |
| 8 | Grundlagen der Sicherheitstechnik | 16 |

### Fragenpool (Fragenpool sheet)
- 224 rows → **218 unique Frage-IDs**. 6 duplicate rows are content-continuation
  fragments (BGB-02, Sicherheitstechnik-02, StGB-01, UmW-01×3, UmW-02) merged
  into the parent question's text/answer during seeding.
- Unique IDs per theme (≥20 each): UmM 40, Sicherheitstechnik 38, UmW 27,
  StGB 26, Datenschutz 24, RdOesO 22, BGB 21, Gewerberecht 20.

### Grading logic (1:1 — DO NOT change)
- **3 Bewertungsstufen:** `richtig` / `teilweise richtig` / `falsch`.
- Per-question points (Pruefung!G8:G15):
  `=IF(F="","",IF(F="richtig",B,IF(F="teilweise richtig",B/2,0)))`
  → richtig = full weight; teilweise richtig = weight/2; falsch = 0.
- **All weights are even**, so weight/2 is always an exact integer — no
  per-question rounding ambiguity.
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
  question per theme** for each NEW exam (1 from each of the 8 themes, theme
  order preserved, no duplicate question-ids within an exam).
- The concrete selection (ids + order) is **persisted** on exam creation and
  never regenerated (reload/reopen/continue keep the same questions).

### Luna transfer
- Only the **single overall percent** is needed — not per-theme breakdowns.
  Copy button copies exactly `NN %` (the overall percent), nothing else.

### Implementation (Phase 8 — DONE)
- **Backend** (`backend/src/oral/`): `themes.ts` (8 themes + weights),
  `scoring.ts` (Excel G8–G20 parity: `questionPoints`, `totalPoints`,
  `percentValue` via `total*100/max` to avoid IEEE-754 artefacts, `passResult`,
  `scoreExam`), `randomize.ts` (`mulberry32` seeded RNG, `drawExam` → 8 slots
  one-per-theme in order, `groupByTheme`, avoid-set for consecutive exams),
  `seed.ts` (idempotent upsert of 8 themes + 218 questions from JSON),
  `service.ts` (`createExam`/`rateQuestion`/`completeExam`/`getExam` — atomic
  persistence, immutable question set, auto-recompute on every rating).
- **API** (`backend/src/api/routes/oral.ts`): public `GET /themes`, `GET /pool`,
  `GET /exams`, `GET /exams/:id`, `GET /exams/:id/score`; auth-gated
  `POST /exams`, `PATCH /exams/:id/questions/:order`, `POST /exams/:id/complete`,
  `PATCH /exams/:id`, `POST /seed`. Registered in `app.ts`.
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
  `oral-randomize.test.ts` (11), `oral-service.test.ts` (18 incl. API+auth),
  `frontend/tests/oral-parity.test.tsx` (9 incl. Luna copy). All green:
  backend 159 (incl. 59 oral), frontend 84 (incl. 9 oral).
- **E2E verified** in-browser: create exam → rate 8 questions → live %
  updates → complete → result screen (100 %, Bestanden) → copy button →
  appears in list. Dark mode renders correctly.

## Task 10 — Admin login (username + password)

Secure browser login for the admin area, replacing the manual token entry as
the primary path. The legacy shared secret still works — this is additive.

### Backend
- **`backend/src/api/passwords.ts`** — `scrypt` hashing/verification (Node
  built-in, no dependency). Stored format `scrypt$N$r$p$salt$hash`.
- **`backend/src/api/session.ts`** — in-process session store (opaque
  256-bit token → username + expiry, TTL `ADMIN_SESSION_TTL_HOURS`, default 8 h).
  Not persisted: a restart invalidates sessions (fails closed).
- **`backend/src/api/rate-limit.ts`** — fixed-window login limiter keyed by
  IP+username (`ADMIN_LOGIN_MAX_ATTEMPTS` / `ADMIN_LOGIN_WINDOW_MINUTES`).
- **`backend/src/api/admin-credentials.ts`** — resolves `ADMIN_USERNAME`
  (default `admin`) + `ADMIN_PASSWORD_HASH` (preferred) or `ADMIN_PASSWORD`.
  Credentials come from env only — never from code or the database.
- **`backend/src/api/csrf.ts`** — Origin/Referer check for cookie-authenticated
  state-changing requests. Allowed origins = `APP_ORIGIN` + `X-Forwarded-Host`
  /`Host` + the request URL's own origin.
- **`backend/src/api/admin-auth.ts`** — the SINGLE gate. Accepts a valid
  session cookie (CSRF-checked) OR a legacy `Bearer ADMIN_TOKEN` (CSRF-exempt).
  `ADMIN_SESSION_COOKIE = ihk_admin_session`. Fails closed (503) when nothing
  is configured.
- **`backend/src/api/routes/auth.ts`** — `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`. Mounted at `/api/auth` in
  `app.ts`. Cookie: HttpOnly, SameSite=Lax, Path=/, Secure in production (or
  `ADMIN_COOKIE_SECURE=1`).
- **`backend/src/scripts/hash-admin-password.ts`** — prints an
  `ADMIN_PASSWORD_HASH` value: `npx tsx src/scripts/hash-admin-password.ts 'pw'`.

### Frontend
- **`/admin/login`** — username/password form (password show/hide toggle,
  loading state, friendly errors incl. 429 lockout). Redirects to `/admin`
  when already authenticated.
- **`/admin`** — session-first: shows the logged-in user + Abmelden; falls back
  to the token form ("Token verwenden") and the login page when unauthenticated.
- **`frontend/src/lib/api.ts`** — `credentials: "include"` on every request;
  `authLogin/authLogout/authMe`; `authHeader()` makes the legacy token optional
  on admin/oral write calls (cookie used when absent).
- **`frontend/src/middleware.ts`** — forwards `Set-Cookie` verbatim (multiple
  headers) and passes `X-Forwarded-Host`/`-Proto` so backend CSRF sees the real
  public origin. `Header.tsx` has an "Admin" nav link.

### Config (`.env.example` documents all; real values never committed)
`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD`, `ADMIN_SESSION_TTL_HOURS`,
`ADMIN_LOGIN_MAX_ATTEMPTS`, `ADMIN_LOGIN_WINDOW_MINUTES`, `APP_ORIGIN`,
`ADMIN_COOKIE_SECURE`, plus the pre-existing `ADMIN_TOKEN`. docker-compose
passes them through with defaults.

### Tests
`backend/tests/auth.test.ts` (25: login, invalid creds, unauth writes, access
after login, logout, expiry, CSRF incl. proxy host, rate limit, legacy token,
fail-closed) and `frontend/tests/admin-login.test.tsx` (6: fields, toggle,
login+redirect, error, 429, already-authed). Green: backend 186, frontend 102.
E2E smoke-tested against a live server (login → cookie → CSRF reject → write
→ logout → 401; legacy bearer still 200; rate limit 429).

**Initial local credentials:** username `admin`, password `dbasicherheit26`
(only in the gitignored `.env`; the repo stores no plaintext password).
