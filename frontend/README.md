# IHK Prüfungsübersicht — Web-GUI (Phase 5)

Next.js 14 Frontend, das die read-only Hono-REST-API (Phase 4) konsumiert.

## Übersicht

- **Framework:** Next.js 14 (App Router, React Server Components + Client Islands)
- **Sprache:** TypeScript 5.4
- **Styling:** Globales CSS (`src/styles/globals.css`), kein UI-Framework
- **API-Anbindung:** typed fetch helpers in `src/lib/api.ts`, Proxy über Edge-Middleware
- **Tests:** Vitest + Testing Library (152 Tests, 12 Suites)

## Seiten

| Route | Beschreibung |
|-------|-------------|
| `/` | IHK-Liste mit Suche, Bundesland-Filter und Paginierung |
| `/ihk/[id]` | Detailansicht einer IHK (Quelle, Import-Status, Semantik) |
| `/fragen` | Fragen-Katalog mit Filter |
| `/fallbeispiele` | Fallbeispiele mit Filter |
| `/muendliche-pruefung` | Mündliche §34a-Prüfung (13 Fragen, 9 Themenbereiche) — Prüfer & Admin |
| `/admin` | Verwaltung (Import triggern, API-Status, Benutzerverwaltung) — nur Admin |

## Entwicklung

```bash
# Backend muss laufen (Port 3001)
cd ../backend && DATABASE_URL="file:./prisma/dev.db" ADMIN_TOKEN=dev PORT=3001 npm run serve

# Frontend starten
npm run dev
# -> http://localhost:3000  (proxyt /api -> http://localhost:3001)
```

Die `/api/*`-Requests werden von `src/middleware.ts` zur Laufzeit an `BACKEND_URL`
(Standard: `http://localhost:3001`) weitergeleitet. Middleware statt
`next.config.js` rewrites(), weil Next.js rewrites zur Build-Zeit einbackt und die
Backend-URL so erst zur Laufzeit konfigurierbar bleibt (wichtig für Docker).

## Tests

```bash
npm test          # vitest run
npm run test:watch
```

Test-Suiten:
- `tests/api.test.ts` — API-Client (Pagination, Filter, Search, Detail, Admin-Import, Error-Handling)
- `tests/display.test.ts` — Display-Helfer (`display()`, `isMissing()`)
- `tests/components.test.tsx` — Badge, SkpBadge, Pagination, States, IhkCard
- `tests/interactive.test.tsx` — SearchBar (Debounce), FilterPanel (Chip-Toggle, Reset)
- `tests/auth-access.test.ts`, `tests/auth-ui.test.tsx`, `tests/middleware.test.ts` — Rollen (`admin` | `examiner`), Seiten-/API-Gates, Session
- `tests/oral-parity.test.tsx`, `tests/oral-admin-ui.test.tsx` — Mündliche Prüfung (13-Fragen-Parität, PDF, Löschen)

## Production-Build

```bash
npm run build     # Next.js standalone output (.next/standalone)
```

Das `output: "standalone"` in `next.config.js` erzeugt einen eigenständigen
Server-Bundle für das Docker-Image (kein `node_modules` im Runtime-Image nötig).

## Docker

Das Frontend wird über `frontend/Dockerfile` als Multi-Stage-Build gebaut
(Builder-Stage installiert Deps + baut Next.js, Runtime-Stage enthält nur den
standalone-Server + statische Assets).

In `docker-compose.yml` ist der Service `ihk-web` (Port 12000 → 3000) integriert
und hängt von `ihk-api` (healthy) ab. Die `BACKEND_URL` zeigt im Container-Netz
auf `http://ihk-api:3001`.
