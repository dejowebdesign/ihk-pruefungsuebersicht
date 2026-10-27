"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, type ImportStatus, type SchedulerStatus } from "@/lib/api";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([api.importStatus(), api.adminStatus()]);
      setStatus(s);
      setScheduler(a.scheduler);
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Status konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runImport() {
    setImporting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.triggerImport();
      setNotice(res.message ?? "Import angestoßen.");
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Import fehlgeschlagen.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div className="section-h">
        <div>
          <h1 className="section-h__title">Verwaltung</h1>
          <p className="muted">Datenimport, Scheduler-Status und Benutzerverwaltung.</p>
        </div>
      </div>

      <div className="admin-grid">
        <section className="admin-card">
          <h3>Benutzerverwaltung</h3>
          <p className="card__text">
            Teilnehmerkonten anlegen, Passwörter zurücksetzen und Konten deaktivieren.
          </p>
          <a className="btn btn--primary" href="/admin/users">
            Benutzer verwalten
          </a>
        </section>

        <section className="admin-card">
          <h3>Datenimport</h3>
          <p className="card__text">
            Importiert die IHK-Übersicht aus der Google-Sheets-Quelle.
          </p>
          {notice && <p className="inline-notice">{notice}</p>}
          <button className="btn btn--primary" onClick={runImport} disabled={importing}>
            {importing ? "Import läuft …" : "Import starten"}
          </button>
        </section>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <p className="muted">Status wird geladen …</p>
      ) : (
        status && (
          <section className="card" style={{ marginTop: 20, padding: 20 }}>
            <h3>Import-Status</h3>
            <div className="kv">
              <span className="kv__k">Letzter erfolgreicher Import</span>
              <span className="kv__v">
                {status.lastSuccess ? formatDateTime(status.lastSuccess.startedAt) : "—"}
              </span>
              <span className="kv__k">Datensätze (IHK-Standorte)</span>
              <span className="kv__v">{status.lastSuccess?.ihkLocations ?? "—"}</span>
              <span className="kv__k">Scheduler</span>
              <span className="kv__v">
                {scheduler
                  ? scheduler.running
                    ? `aktiv (alle ${scheduler.intervalHours} h)`
                    : "inaktiv"
                  : "—"}
              </span>
            </div>
          </section>
        )
      )}
    </div>
  );
}
