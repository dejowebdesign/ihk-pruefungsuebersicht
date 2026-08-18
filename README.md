# IHK Prüfungsübersicht

Automatisierter Import und Datenplattform für **§34a Sachkundeprüfung**-Informationen der Industrie- und Handelskammern (IHK).

Dieses Projekt liest eine öffentlich zugängliche Google-Tabelle („Prüfungsübersicht 2.0“) regelmäßig aus, speichert die Daten in einer lokalen Datenbank und stellt sie über eine API einer modernen Web-GUI bereit. Benutzer greifen **ausschließlich** auf die lokale Datenbank zu — niemals bei jedem Seitenaufruf direkt auf Google Sheets.

> Unabhängiges Projekt. Kein Bestandteil von „Quiz0r“.

---

## Architektur

```
Google Sheet (öffentliche Quelle)
        ↓
   Importer (gviz/tq, lesend)
        ↓
   Validierung (Fail-safe)
        ↓
   SQLite  (Prisma, PG-ready)
        ↓
     API (später)
        ↓
   Frontend (Next.js, später)
```

**Schichten:**

| Schicht | Technologie | Status |
|---|---|---|
| Importer | Node.js + TypeScript, Google Visualization API (gviz) | ✅ Snapshot-Import |
| Datenbank | SQLite + Prisma (PostgreSQL-ready) | ✅ Schema + Migration |
| Validierung | Eigene Logik, Fail-safe | ✅ |
| API | REST (Hono) | ✅ Phase 4 |
| Frontend | Next.js + TypeScript | Phase 6+ |
| Scheduler | Mutex-Scheduler + „Jetzt aktualisieren“ | ✅ |

---

## Datenquelle

- Spreadsheet: `Prüfungsübersicht 2.0` (öffentlich)
- Zugriffsmethode: Google Visualization API (`gviz/tq?tqx=out:json&gid=<gid>`), **kein API-Key nötig**, rein lesend.
- 85 Register, davon 4 Spezial-Register + 81 IHK-Stadtregister.
- Die `SHEET_ID` ist in `.env.example` als `GOOGLE_SHEET_ID` konfigurierbar.

Referenz-Snapshot: `data/snapshot/*.json` (85 Dateien + `_manifest.json`) — dient als initiale Befüllung, Test- und Fallback-Daten.

---

## Datenmodell

Siehe `backend/prisma/schema.prisma`. Wesentliche Entitäten:

| Entität | Bedeutung |
|---|---|
| `ImportRun` | Ein Importvorgang (Status RUNNING/SUCCESS/PARTIAL/FAILED, Zähler, Fehler). |
| `Sheet` | Ein Register: Originalname, gid, Typ, Zeilen-/Spaltenzahl, Headers + komplette Roh-Zeilen als JSON. |
| `IhkLocation` | Normalisierte IHK-Stammdaten, **abgeleitet nur aus der „Übersicht“** (konsistente Spalten). |
| `Question` | Mündliche Prüfungsfrage aus `Master_Fragen_Muendlich` (244 Zeilen). |
| `CaseExample` | Fallbeispiel aus `Master_TOP_Fallbeispiele` (30 Zeilen). |
| `IhkRawRow` | Originalzeile jedes Registers, **verlustfrei** gespeichert. |
| `IhkSemantics` | Best-Effort-Felder aus Stadtregistern (nur sicher ableitbare Werte, sonst `null`). |
| `ChangeRecord` | Vorbereitet für Änderungsverfolgung (später befüllt). |

**Wichtige Prinzipien:**

- Rohdaten bleiben immer erhalten — kein Datenverlust durch Normalisierung.
- Unbekannte Werte werden als `null` gespeichert, **niemals geschätzt**.
- Normalisierte IHK-Stammdaten kommen nur aus der `Übersicht`, nicht aus den inkonsistenten Stadtregistern (diese haben 2 Layout-Varianten).
- Stadtregister-Semantik ist Best-Effort und explizit als solche markiert.

---

## Lokale Entwicklung

Voraussetzungen: Node.js ≥ 20, npm ≥ 10.

```bash
cd backend
cp ../../.env.example .env          # dann Werte prüfen
npm install
npx prisma generate
npx prisma migrate dev --name init  # legt SQLite-DB an
npm run import:initial              # einmaliger Snapshot-Import
```

---

## Datenbankinitialisierung

- SQLite-Datei: `backend/prisma/dev.db` (in `.gitignore`).
- `DATABASE_URL` in `.env` setzen (Default: `file:./prisma/dev.db`).
- Für PostgreSQL später einfach `DATABASE_URL` umbiegen — das Schema verwendet keine SQLite-spezifischen Typen.

---

## Initialimport

```bash
npm run import:initial
```

Liest `data/snapshot/*.json`, validiert gegen die Erwartungen (85 Sheets, alle kritischen Register, plausible Zeilenzahlen) und schreibt in SQLite. Bei Validierungsfehler wird **kein** existierender Datenbestand angetastet (Fail-safe).

Erwartete Mengen nach Erfolg:

- 85 Sheets
- 82 IHK-Standorte (aus Übersicht)
- 244 Fragen
- 30 Fallbeispiele
- ~3259 Rohdaten-Zeilen

---

## Tests

```bash
cd backend
npm test
```

Abgedeckte Bereiche:

- JSON-Parsing & Manifest-Integrität
- Sheet-Erkennung / Klassifikation
- `Übersicht → IhkLocation` Normalisierung
- Stadtregister-Parsing, **beide Layout-Varianten** (A: diskrete Felder, B: zusammengezogen)
- Rohdatenspeicherung (verlustfrei)
- Validierung (Fail-safe bei kritischen Fehlern, Warnung bei Drift)
- Initialimport gegen eine isolierte Test-DB
- **Regression**: `Master_Fragen_Muendlich` = 244 Zeilen

---

## Spätere Importstrategie (Phase 3+)

- Regelmäßiger, konfigurierbarer Import (Default alle 6 h) direkt aus Google Sheets via gviz.
- „Jetzt aktualisieren“ im Admin-Bereich.
- Fail-safe: temporäre Google-Unerreichbarkeit löscht niemals die letzte gültige Version.
- Change Detection: Feldänderungen zwischen erfolgreichen Imports → `ChangeRecord`.
- Importstatus im Admin-Bereich: letzter Erfolg, letzter Versuch, nächste geplante Ausführung, Änderungszahl, letzter Fehler.

---

## Projektstruktur

```
ihk-pruefungsuebersicht/
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── db/           # Prisma client
│   │   ├── importer/     # Snapshot-Import (Phase 2), Google-Import (Phase 3)
│   │   ├── lib/          # Typen, Loader, Klassifikation, Normalisierung, Validierung
│   │   └── scripts/      # CLI: initial-import
│   └── tests/            # vitest
├── data/snapshot/        # 85 JSON-Dateien + _manifest.json (Referenz)
├── scripts/              # später: Operation-Skripte
├── .env.example
├── .gitignore
└── README.md
```

---

## Sicherheit

- Keine Secrets im Repository.
- `.env` ist gitignored; nur `.env.example` wird committet.
- Google-Sheet-ID ist Konfiguration, kein Secret.
- Admin-Auth ausschließlich über Umgebungsvariable `ADMIN_TOKEN` (constant-time Vergleich, fails-closed bei fehlendem Token).
- API gibt nie Stacktraces oder Secrets zurück; Fehler werden sauber als JSON gemeldet.
- Öffentliche Endpunkte greifen nur auf die SQLite-Datenbank zu — niemals auf Google Sheets.

---

## API (Phase 4)

Die API läuft mit [Hono](https://hono.dev/) auf Node.js. Alle öffentlichen Endpunkte greifen **nur auf die lokale Datenbank** zu und sind auf den letzten erfolgreichen ImportRun begrenzt. Pagination via `?page=1&limit=50` (Limit max. 200, Default 50). Auth nur für `/api/admin/*` erforderlich.

### Starten

```bash
cd backend
cp ../.env.example ../.env        # ADMIN_TOKEN setzen!
npm run serve                     # http://localhost:3001
npm run serve:scheduler           # API + Scheduler zusammen
```

### Endpunkte

| Methode | URL | Auth | Beschreibung |
|---|---|---|---|
| GET | `/api/health` | nein | `{status, database, timestamp, version}` — Docker Healthcheck |
| GET | `/api` | nein | Endpoint-Übersicht |
| GET | `/api/ihk` | nein | IHK-Liste, filterbar, paginiert |
| GET | `/api/ihk/search?q=...` | nein | Suche in Kurzname/offizieller Name/Bundesland |
| GET | `/api/ihk/:id` | nein | IHK-Detail + Provenienz (Sheet, Importzeit) |
| GET | `/api/sheets` | nein | Alle 85 Register (Metadaten), paginiert |
| GET | `/api/sheets/:id` | nein | Register-Metadaten + Counts (keine Rohdaten) |
| GET | `/api/questions` | nein | Fragen, filterbar/durchsuchbar, paginiert |
| GET | `/api/questions/:id` | nein | Einzelfrage |
| GET | `/api/case-examples` | nein | Fallbeispiele, filterbar/durchsuchbar, paginiert |
| GET | `/api/case-examples/:id` | nein | Einzelfallbeispiel |
| GET | `/api/import/status` | nein | Letzter Erfolg + letzter Versuch, Counts, letzter Fehler |
| GET | `/api/import/runs` | nein | Import-Historie (nur Metadaten), paginiert |
| GET | `/api/admin/status` | **ja** | Import- + Scheduler-Status kombiniert |
| GET | `/api/admin/scheduler` | **ja** | Scheduler-Status (running, Intervall, last success/attempt) |
| POST | `/api/admin/import` | **ja** | Manuelles Import-Trigger (mutex-geschützt, 409 wenn belegt) |

### Query-Parameter

- **Pagination:** `?page=1&limit=50` (auf allen Listenendpunkten)
- **IHK-Filter:** `?bundesland=`, `?skp=`, `?writtenForm=`, `?writtenResultImmediate=`, `?sameDay=`, `?intervalWrittenOral=`, `?groupFormat=`
- **IHK-Suche:** `?q=bie` (mindestens 2 Zeichen, durchsucht `ihkShortName`, `officialName`, `bundesland`)
- **Sheets-Filter:** `?sheetType=IHK`
- **Fragen-Filter/Suche:** `?category=`, `?difficulty=`, `?cluster=`, `?q=` (Frage/Antwort/Rechtslehre)
- **Fallbeispiele-Filter/Suche:** `?category=`, `?cluster=`, `?q=` (Szenario/Antwort/Rechtslehre)

### Beispielantworten

`GET /api/health`
```json
{ "status": "ok", "database": "ok", "timestamp": "2026-08-17T15:51:10Z", "version": "0.4.0" }
```

`GET /api/ihk?limit=2`
```json
{
  "data": [
    { "id": "...", "nr": 1, "ihkShortName": "Aachen", "officialName": "...", "skp": "✅", "bundesland": "Nordrhein-Westfalen", "writtenForm": "Laptop/PC", ... }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 82, "totalPages": 41 }
}
```

`GET /api/import/status`
```json
{
  "lastSuccess": { "id": "...", "status": "SUCCESS", "sheetsImported": 85, "ihkLocations": 82, "changeCount": 0, "lastError": null, ... },
  "lastAttempt": { "id": "...", "status": "SUCCESS", ... }
}
```

### Authentifizierung (Admin)

Admin-Endpunkte benötigen `Authorization: Bearer <ADMIN_TOKEN>`. Token via Umgebungsvariable `ADMIN_TOKEN` (z. B. `openssl rand -hex 32`). Ohne gesetzten `ADMIN_TOKEN` antworten alle Admin-Endpunkte mit `503` (deaktiviert, fails-closed). Falscher/fehlender Token → `401`. Die Architektur ist so gehalten, dass später auf JWT/Sessions umgestellt werden kann, ohne Route-Handler zu ändern.

### Statuscodes

`200` OK · `207` Partial · `400` Bad Request · `401` Unauthorized · `403/404` Not Found · `409` Import bereits laufend · `500` Serverfehler · `503` Keine Daten/Admin deaktiviert.

---

## Lizenz

MIT
