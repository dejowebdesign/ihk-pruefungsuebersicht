"use client";
import { useEffect, useState } from "react";
import { api, ApiClientError, type ImportRun } from "@/lib/api";

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
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

export function Footer() {
  const [updated, setUpdated] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .importStatus()
      .then((s) => {
        if (cancelled) return;
        const run: ImportRun | null = s.lastSuccess;
        setUpdated(run ? formatDateTime(run.startedAt) : null);
        setFailed(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailed(true);
        if (e instanceof ApiClientError && e.status === 503) {
          setUpdated(null);
          setFailed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <span>IHK Prüfungsübersicht · §34a Sachkundeprüfung</span>
        <span className="site-footer__updated">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
          {failed
            ? "Daten zuletzt aktualisiert: nicht verfügbar"
            : updated
              ? `Daten zuletzt aktualisiert: ${updated} Uhr`
              : "Daten noch nicht importiert"}
        </span>
      </div>
    </footer>
  );
}
