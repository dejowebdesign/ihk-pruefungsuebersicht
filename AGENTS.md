# IHK Prüfungsübersicht — Agent Notes

Standalone GitHub project (`ihk-pruefungsuebersicht`). Independent of Quiz0r — do
NOT modify Quiz0r.

## Architecture

- **backend/** — Hono REST API (read-only) on Prisma + SQLite. Tests via Vitest
  (`npm -w backend test`, 97 tests). Start: `npm -w backend run serve` with
  `DATABASE_URL`, `ADMIN_TOKEN`, `PORT` env. The `serve` script defaults to
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
