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
  `backend/src/api/admin-auth.ts` (deleted). Roles: `admin` | `examiner` (the
  retired `participant` role was fully replaced — see "Role cleanup" below).
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
   `app.use("/api/*", …)` in `app.ts`. An examiner cannot reach an admin-only
   endpoint even when the UI is bypassed. Unknown paths resolve to `public` so
   they 404 normally instead of a misleading 401.
   - Public: `/api`, `/api/health`, `/api/auth/*`, legacy `/api/admin/*`.
   - Authenticated (both roles): `/api/ihk` + `/api/ihk/search` + `/api/ihk/:id`
     (they back the start page `/` and the detail pages `/ihk/:id`), and
     `/api/oral/*` except `/oral/seed`.
   - Admin-only: `/questions`, `/case-examples`, `/sheets`, `/import`, `/users`,
     and `POST /api/oral/seed` (seeding rewrites the shared pool).
2. **Route guards** — `requireAdmin` / `requireStaff` / `requireAuth` /
   `adminGuard` (`backend/src/api/identity.ts`). `requireStaff` = admin **or**
   examiner; it guards the whole oral simulation (create, rate, complete, PDF,
   delete), because both roles run exams with identical rights. `requireAdmin`
   stays on everything outside it. Roles are **never** read from request data:
   the exam creator is taken from the session (`identity.userId`), and a `userId`
   in a request body is ignored.

### Staff-wide exams (no per-user scoping)
- The oral simulation is a **shared staff area**: every examiner and admin sees
  and edits the same exams. `OralExam.userId` is an **audit-only** record of who
  created the exam; it is never used as an access filter. (Earlier per-owner
  `examScope()` scoping was removed with the role cleanup — `examScope` and
  `canReadExam` no longer exist.)
- An unknown exam id is **404** for everyone.
- `frontend/src/middleware.ts` gates pages server-side (examiner: `/`, `/ihk*`
  and `/muendliche-pruefung*`; everything else redirects to `/`). `/login` is
  public and bounces signed-in users onward.

### Role cleanup (`admin` | `examiner`) — migration `20261027000000_examiner_role`
- The `participant` role is **retired**. Migration
  `backend/prisma/migrations/20261027000000_examiner_role/migration.sql` converts
  every existing `role = 'participant'` row to `'examiner'` (SQLite table-rebuild,
  since the column default also changes) and sets the new default to `'examiner'`.
  It is **data-preserving**: usernames, password hashes, `active`/`disabledAt`,
  sessions, exams, ratings and the question pool are all kept. The migration is
  executed verbatim in `backend/tests/auth.test.ts` (via `node:sqlite`
  `DatabaseSync.exec`) against a DB seeded with participants + exam history, and
  the test asserts conversion *and* preservation.
- `isRole()` only accepts `admin`/`examiner`; a `participant` value in a create
  body falls back to the `examiner` default, and a `PATCH { role: "participant" }`
  is rejected with **400 "invalid role"**. The client-side
  `canAccessPath()` also refuses unknown role strings instead of falling through
  to the examiner branch.
- The IHK-Vergleich was removed with this cleanup: `/vergleich` page,
  `ComparisonTable.tsx`, `lib/compare.ts` and their tests are deleted, and the
  IHK cards are now a **single `<a>`** (no `+`/compare toggle) — one link per
  card, reachable by mouse, keyboard and touch.

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
- `DELETE /api/oral/exams/:id` requires `requireStaff` and explicit confirmation
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
- Migrations are **additive / data-preserving**: `20260827000000_users_sessions`
  adds `User`/`Session` and nullable `OralExam.userId` (ON DELETE SET NULL);
  `20261027000000_examiner_role` rebuilds `User` only to change the role default
  and convert `participant` → `examiner`. Both preserve every existing row.
- Changing `User.role`'s default requires `npx prisma generate` before the tests
  see it — the checked-in client is stale otherwise.

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
- Run: `npx vitest run` (152 tests across 12 suites, all passing).

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

**`public/` is NOT part of the standalone output.** `next build` with
`output: "standalone"` emits `.next/standalone/frontend/` without a `public/`
directory (verified: the path does not exist after a build), so any static
asset in `frontend/public/` must be copied explicitly in `frontend/Dockerfile`:

```dockerfile
COPY --from=build /app/frontend/public ./frontend/public
```

Without it the file 404s in the container while working fine in `next dev`.
The hero background (`frontend/public/hero.png`) depends on this.

## Hero background image

`frontend/public/hero.png` (1962×802) is the start-page hero background. The
left half of the photo is dark and empty by design, which is where the heading,
subtitle, search field and note sit, so the scrim runs left→right and leaves the
officer on the right visible.

- Two background layers: `linear-gradient(scrim), url("/hero.png")`. The scrim
  is a layer rather than an extra element, so the hero markup is unchanged.
- `background-size: cover` on **both** layers (aspect ratio preserved, no
  distortion) and `background-position: center, right center` — when a viewport
  is narrower than the photo the right half with the officer stays in frame.
  Desktop crops ~48% vertically, tablet ~13% vertically, mobile ~49%
  horizontally.
- Hero text uses **fixed light colours** (`#f5f8fb` etc.) plus a small
  `text-shadow`, NOT theme tokens: `--text` is dark in light mode and would be
  unreadable on the photo. Measured contrast ≥13:1 at all three widths.
- The old frosted band's `backdrop-filter` is dropped for `.hero` (it would blur
  the photo). The `--glass-blur-sm` token is still used by the sticky header/nav.
- Below 768px the text spans the full width instead of only the dark side, so
  the mobile override flattens the scrim (0.84 → 0.58) rather than fading out.
- `frontend/tests/hero-background.test.ts` guards all of the above by parsing
  `globals.css`; mutation-checked against 9 regressions.

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
- Pool per theme (after extension): StGB 66, UmW 58, Sicherheitstechnik 53,
  UmM 50, BGB 44, Datenschutz 42, RdOesO 33, Gewerberecht 20, UVV 11 (377 total).

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

## Question-pool quality audit (branch `fix/oral-question-quality`, PR #7)

- **`ensureOralPoolSeeded` content guard.** It used to short-circuit on
  `existing >= seedRows.length`, so an edited question text in
  `oral-questions.json` never reached a populated DB. It now compares stored
  content field-by-field against the seed file (`poolMatchesSeed`) and runs the
  upsert pass on missing rows *or* outdated text. Still idempotent: upsert by
  unique `excelId` preserves row `id`, and `OralExam`/`OralExamQuestion`/
  `OralCandidate` are never touched. **Any future seed-text edit therefore
  propagates on restart — no manual command needed.**
- **Exams read question text live** via the pool join (`api/routes/oral.ts`),
  while rating/points/weight/note are snapshotted on `OralExamQuestion`. So
  text corrections never alter historical scores; only display text changes.
- **Pool count is now 377** (was 342). Two tests hardcode the count:
  `oral-service.test.ts` (`SEED_QUESTION_COUNT`) and `oral-pdf-delete.test.ts`
  (`.toBe(377)`).
- **`seedFingerprint()`** (exported from `src/oral/seed.ts`) hashes the pool
  text. `tests/oral-question-quality.test.ts` asserts the exact value, so any
  pool edit must update that hash deliberately.
- **OCR pattern to know:** `ff` was mis-read as `2`, `6`, `K`, `O`, `X`, `c`
  (e.g. `Schusswa6en`, `zugri2sbereit`, `Öcentliche`). `§` also appears as a
  bullet character. Both are covered by the new regression test's word list.
- **Audit report:** `docs/oral-question-quality-audit.md`, generated from the
  real `git diff main` — 80 changed records with category/severity/status.
- **Legal sources were unreachable** from the sandbox
  (`gesetze-im-internet.de` blocked, Tavily quota exhausted). No check against
  official statute text was performed and none is claimed; two records are
  explicitly left open (`Sicherheitstechnik-31`, `Datenschutz-22`).

## Phase 10 — 35 new questions imported (DONE)

- **+35 questions**: 27 `Umgang mit Waffen` (`UmW-32`…`UmW-58`, was 31) and
  8 `Straf- und Verfahrensrecht` (`StGB-59`…`StGB-66`, was 58). Pool 342 → 377.
  All imported **verbatim** from the task text; no existing record changed, none
  deleted, no duplicates found. Append-only diff in
  `backend/prisma/seed/oral-questions.json`.
- **Pool per theme (after Phase 10):** StGB 66, UmW 58, Sicherheitstechnik 53,
  UmM 50, BGB 44, Datenschutz 42, RdOesO 33, Gewerberecht 20, UVV 11.
  (Phase 11 merged RdOesO+Gewerberecht and added 54 more — see the Phase 11
  section for the current figures.)
- **Text was generated from the source, never retyped.** A parser
  (`/tmp/q35/parse_original.py` at the time; the authoritative copy now lives in
  `tests/oral-import-2026.test.ts` as `EXPECTED`) produced the records, which
  caught two manual transcription errors (a `Behältnis` typo and lost blank
  lines). Prefer generating over retyping for future bulk imports.
- **Newline convention:** these 35 are the first pool entries whose `erw`
  contains real `\n` (bullet lists). Existing entries separate items with `•`.
  `.oral-take__answer` already sets `white-space: pre-wrap`, so they render
  correctly — but if you add a new answer surface, keep `pre-wrap`.
- **`quelle` must be copied byte-for-byte** from an existing record of the same
  theme. The file mixes NFC/NFD; typing the filename by hand introduces a new
  (differently-normalised) source string. `tests/oral-import-2026.test.ts`
  asserts `sources.size === 9` to catch this.
- **Tests:** `backend/tests/oral-import-2026.test.ts` (13 tests) pins all 35
  pairs verbatim, the id range, theme mapping, umlaut/quote fidelity, list
  lengths, append-only pre-existing records, and the 9 source strings. It was
  mutation-tested (10 mutations: reword, shorten, wrong theme, duplicate,
  umlaut strip, delete, pre-existing edit, renumber, invented source, invented
  option) — all 10 caught.
- **Review notes:** `docs/oral-import-2026-review.md` lists formatting quirks
  (hyphen artifacts from the source line-wraps, e.g. `Geschäfts-räume`,
  `wider-streitenden`) and open questions (overlap with `UmW-08`, `StGB-32/33/35`).
  Nothing was corrected — the flagged text is stored verbatim.
- **Verified end-to-end:** backend 329 tests, frontend 167 tests, production
  build ✓; all 35 served by `GET /api/oral/pool`, drawn into real exams, and
  rendered in the take-screen with intact umlauts.
- **Sections 2–4 of that task (auth, user management, PDF export, exam delete)
  were already on `main`** (PRs #3/#4/#5) — verified, not rebuilt.
## Phase 11 — 8 themes + weighted percentage scoring (DONE)

Replaces the Phase 8–10 model. The customer confirmed two decisions:
**A1** merge Gewerberecht into RdOesO; **B1** keep the three-stage rating.

### Themes (8) and weights (sum = 100)
| # | Themenbereich | weight | questions/exam |
|---|---|---:|---:|
| 1 | Buergerliches Gesetzbuch / Jedermannsrechte | 18 | 2 |
| 2 | Straf- und Verfahrensrecht | 18 | 2 |
| 3 | Umgang mit Menschen / Deeskalation | 18 | 2 |
| 4 | Recht der oeffentlichen Sicherheit und Ordnung einschliesslich Gewerberecht | 10 | 2 |
| 5 | Datenschutzrecht | 9 | 1 |
| 6 | Unfallverhuetungsvorschriften | 9 | 1 |
| 7 | Umgang mit Waffen | 9 | 1 |
| 8 | Grundlagen der Sicherheitstechnik | 9 | 1 |

The former `Gewerberecht / Bewachungsverordnung` and `Recht der oeffentlichen
Sicherheit und Ordnung` are ONE theme now (label keeps the transliterated
spelling so it stays byte-comparable with the seed data). All 20 Gewerberecht
questions were kept; both prefixes (`Gewerberecht-*`, `RdOesO-*`) share the one
pool. `ORAL_LEGACY_THEME_ALIASES` + `normalizeThemeName()` map the old names onto
the merged one so **historical exams stay scoreable**.

### Exam composition (exactly 13)
4 main themes × 2 = 8, 4 other themes × 1 = 4, plus **1 rotating** question from
one of the 4 other themes. Max 2 per theme, no duplicate question. `drawExam()`
self-checks the shape and **throws** if the pool cannot satisfy it — it never
emits a wrongly-shaped exam.

### Rotation (persisted, concurrency-safe)
`OralRotationState` (single row, id `oral-rotation`) holds a counter advanced with
an atomic `increment` **inside the exam-creation transaction**, so (a) it survives
restarts and never resets to Datenschutz, (b) parallel starts get distinct slots,
and (c) a failed creation rolls the counter back instead of burning a slot.

### Scoring (percentages, 3 stages)
```
theme result   = sum(rating factors) / questions asked of that theme   # 0..1
contribution   = theme result * theme weight                          # pp
total          = sum of the 8 contributions                          # 0..100
```
Rating factors: `richtig` 1.0, `teilweise richtig` 0.5, `falsch`/unanswered 0.
**The weight never depends on how many questions were asked**, so a theme asked
twice is still scored over the same weight (Datenschutz 2/2 correct = 9 %, not
18 %). No premature rounding: every value is a multiple of 0.25 and exact in
IEEE-754 (13.5, 4.5, 6.75). Pass mark = **50 %** (the old 50-of-100 points rule
transferred 1:1).

### The points system is gone from the UI and the PDF
No `Punkte`, no point bars, no max-points anywhere a user can see.
`maxPoints`/`totalPoints`/`OralExamQuestion.points` still EXIST as columns — they
are the legacy model's storage — but are never displayed and stay 0 for percent
exams. `scoringVersion` selects the scorer: **2** = percent (new exams),
**1** = legacy points (every pre-migration exam). `recomputeScoreTx` picks the
scorer from `scoringVersion`, so a historical exam is never reinterpreted.
Do not "clean up" the legacy scorer or columns without checking those tests.

### Migration `20261101000000_percent_scoring_8_themes`
Non-destructive. **`orderKey` is UNIQUE**, so the migration parks ALL theme rows
at 90–98 *before* assigning the final keys 1–8 — assigning orderKey 4 first
collides with Straf- und Verfahrensrecht. The Gewerberecht row is parked
permanently at orderKey 90 (kept, never active) so its questions could be
re-pointed with zero orphan risk. Verified by applying it to a copy of the real
`dev.db` (9 themes/377 questions/106 exams): result = 8 themes summing to 100,
merged theme 53 questions, 0 orphans, all questions/exams/items/users intact.
A seeder run then takes it to 431 questions.

### Data
- **+54 questions** (55 provided − 1 exact duplicate of `UmM-23`): StGB +38,
  merged theme +8 (6 new GewO/BewachV + 2 general), Datenschutz +3, UmW +2,
  UmM +2, Sicherheitstechnik +1. Pool 377 → **431**.
- Pool per theme now: StGB 104, merged RdOesO 61 (35 RdOesO + 26 Gewerberecht),
  UmW 60, Sicherheitstechnik 54, UmM 52, Datenschutz 45, BGB 44, UVV 11.
- **11 "similar but not identical" questions were imported as separate records**
  and documented in `docs/oral-import-phase11-review.md` (rule 2.1: never
  auto-delete or auto-replace a near-duplicate).
- `nr` was **renumbered within the merged theme** (1..61) because both source
  themes numbered from 1 — `nr` is technical metadata; question text and
  `excelId` are untouched. `excelId` values never change (historical exams and
  `OralQuestion.id` stability depend on it).
- Two source hyphen artifacts (`Tatbestandsmerk-male:`, `Tat-bestandsmerkmale:`)
  are preserved verbatim and flagged in the review doc.

### Two real bugs found while doing this
1. **`poolMatchesSeed` ignored the theme**, so a pure re-categorisation (the
   merge) never reached an already-populated DB. It now compares `theme.name` and
   also fails when a stale theme row lingers. Covered by the merged-theme test.
2. **The first migration draft assigned orderKey 4 before renumbering**, which
   violates the UNIQUE constraint on any DB where orderKey 4 is taken. Caught
   only by applying the migration to a real database copy — a syntax check or
   `db push` would not have caught it. **Always test a migration against a copy
   of real data, not just `db push`.**

### Concurrency note (SQLite)
Prisma's default interactive-transaction budget (2 s wait / 5 s runtime) is too
tight for queued writers: parallel exam starts surfaced as a spurious
"Operations timed out". `createExam` now passes `{ maxWait: 30_000, timeout:
30_000 }`, and the test DB uses `?connection_limit=1` so writers serialise
instead of colliding on SQLite's single write lock.

### Tests
`oral-scoring` 40, `oral-randomize` 16, `oral-service` 41 (incl. rotation
persistence, no-burnt-slot, 8-way parallel starts, legacy-exam immutability),
`oral-pdf-delete` 41, `oral-question-quality` 33, `oral-import-2026` 13,
`frontend/tests/oral-percent-ui.test.tsx` 6 (renders the REAL page and asserts
no `Punkte`/`Pkt.` and an exact `13,5`). Backend 354 / frontend 158, build ✓.

## PDF layout pitfalls (`backend/src/oral/pdf.ts`)

- **A PDF baseline is the text's BOTTOM edge, not the top.** `text(value, x, size)`
  uses the current `y` cursor as the baseline, so glyphs are drawn *above* it
  (~0.72 × size ascent). Two calls without an intervening `gap()` share one
  baseline and overprint; a call at a box's top edge draws outside the box.
  This caused the result-box overlap fixed in PR #8.
- **The result box uses fixed offsets from an explicit `boxTop`**, with each
  text pushed as its own op rather than via the shared `y` cursor:
  label `boxTop-15`, threshold line `boxTop-31`, percent `boxTop-34`, status
  `boxTop-52` (box interior is `[boxTop-64, boxTop]`). Keep those offsets inside
  `-0.72*size … -(64 - 0.24*size)`. Phase 11 replaced the old "n von m Punkten"
  line with the static "Bestehensgrenze 50 %" text.
- **`extractPositionedText` sees the WHOLE page, not just the result box.** After
  Phase 11 added a per-theme breakdown table, "Gesamtergebnis" appears three
  times and a naive `expect(hits).toHaveLength(1)` fails. The helper in
  `tests/oral-pdf-delete.test.ts` therefore filters ops to the vertical band of
  the result box rect before matching.
- **Presence-only assertions cannot catch layout bugs.** `extractPdfText()` in
  `tests/oral-pdf-delete.test.ts` only proves a string exists. For geometry use
  `extractPositionedText()` / `extractFilledRects()`, which parse the real
  `Tm` coordinates and `re f` rects out of the content stream. Reverting the two
  offsets makes the `PDF result box layout` suite fail, so it is a true
  regression test.
- **Verifying visually:** no poppler/gs in the sandbox; use
  `pip install pymupdf` (render + `get_text("rawdict")` per-glyph bboxes) and
  `pillow` for side-by-side images. Note PyMuPDF's span `bbox` uses full font
  metrics and is much taller than the ink, so span-level overlap flags are
  mostly false positives — compare *ink bands* from a rendered pixmap, or
  per-glyph bboxes, to judge a real collision.
- **`npm -w backend` needs `DATABASE_URL`** for any script touching Prisma; use
  `DATABASE_URL="file:/tmp/x.db" npx prisma db push --skip-generate --force-reset --accept-data-loss`
  to get an isolated throwaway DB instead of touching `backend/prisma/dev.db`.
- **Pushing:** if `git push` hangs on a password prompt the cached token has
  expired — re-run `git remote set-url origin "https://${GITHUB_TOKEN}@github.com/…"`
  and push with `GIT_TERMINAL_PROMPT=0` so it fails fast instead of hanging.

## Phase 12 — Dark-glass navigation header (DONE)

The navigation bar is a **floating dark-glass surface in both themes** (fixed
`--hd-*` palette, deliberately not theme tokens). Design reference:
`sachkunde.duckdns.org` (Angular, `mat-toolbar`). Measured from the reference:
fill `rgba(9,16,30,.76)`, `blur(18px) saturate(150%)`, radius 22px, a
blue-tinted hairline `rgba(110,168,254,.14)`, `min(1140px, 100% - 28px)` max
width, shadow `0 6px 16px -8px / 0 2px 6px`, nav pills 40px tall / 10px radius /
14px text. Our values mirror these (tokens in `globals.css` under
"dark-glass header palette").

### Shrink-on-scroll
- `useScrolled()` (`frontend/src/lib/use-scrolled.ts`) — passive listener, one
  `requestAnimationFrame` per burst, **asymmetric thresholds** (on > 24px, off
  < 16px) so resting on the boundary cannot flicker. The header adds
  `.site-header--scrolled`.
- The motion is **width-first**: `--header-width` 100% → 90% (`--header-maxw`
  caps at 1440px), radius 0 → 22px, height 96 → 84px, logo 54 → 46px, all on one
  240ms `cubic-bezier(0.22,0.61,0.36,1)` (`--header-motion`).
- **The band height is constant in both states** (`--header-h`), and the bar
  compacts *inside* it, so the page below never reflows. Verified: `main.top`
  identical at scrollY 0 / 600 / 0.
- The floating gap is real **padding on the sticky `.site-header`**, never a
  child margin (a sticky element's child margin collapses through the frame and
  the gap disappears once pinned).

### Layout
- `.site-header__inner` is a grid: `minmax(0,1fr) auto minmax(0,1fr)` — equal
  outer tracks centre the nav; the `minmax(0,…)` floor lets the identity block
  yield instead of overflowing. Below 1049px the nav is hidden and the centre
  track collapses to **0** (not `display:none`, which would hide the mobile
  dropdown that is its child).
- Identity block keeps **both the username and the role chip** (the brief
  requires "Benutzername" and "Rollenkennzeichnung"). The name ellipsises
  (160px → 84px ≤560px → 56px ≤380px) rather than widening the bar.

### Other glass + control
- Footer, cards, panels and dialogs gained the same `@supports` glass upgrade.
- `BackToTop` (`frontend/src/components/BackToTop.tsx`) — round 44px floating
  glass button, appears past 420px, smooth scroll (instant under
  `prefers-reduced-motion`).

### Logo
- `frontend/public/ihk-logo.png` is embedded **verbatim** (sha256
  `ebe0d4e8…`, 1672×941 RGBA, 16:9). `layout.tsx` `findLogo()` probes
  `ihk-logo.png` / `logo.png` / `logo.svg` server-side and passes the path to
  `Header`, which renders `<img class="brand__logo">` with `object-fit: contain`
  and no filter. Falls back to an `IHK` mark only when no file exists.

### Gotchas
- The reference shrinks via **max-width transition**, not transform — copy that,
  not a `scale()`, or the text blurs.
- `@supports` cannot be toggled from JS, so prove the blur by screenshotting
  with and without `backdrop-filter:none` and comparing edge energy (see memory).
- Empty DB ⇒ `GET /api/ihk*` returns **503**; that is "no data yet", not a bug.
