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
| API | REST (Next.js API / Express) | Phase 5 |
| Frontend | Next.js + TypeScript | Phase 6+ |
| Scheduler | Cron + „Jetzt aktualisieren“ | später |

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
- Spätere Admin-Auth kommt ausschließlich über Umgebungsvariablen.

---

## Lizenz

MIT
