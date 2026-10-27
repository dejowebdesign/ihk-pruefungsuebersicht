"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError, type AdminStatus } from "@/lib/api";
import { getStoredToken, clearStoredToken } from "@/lib/oral-auth";
import { ErrorState } from "@/components/States";

const TOKEN_KEY = "ihk-admin-token";

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
  const router = useRouter();
  // Session-based login is the primary path; a stored legacy token still works.
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [token, setToken] = useState("");
  const [stored, setStored] = useState(false);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);

  useEffect(() => {
    const t = getStoredToken();
    if (t) {
      setToken(t);
      setStored(true);
    }
    api
      .authMe()
      .then((me) => {
        setSessionUser(me.authenticated ? me.username : null);
      })
      .catch(() => setSessionUser(null))
      .finally(() => setCheckedSession(true));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.adminStatus(stored && token ? token : undefined));
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : null;
      setError(msg);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [stored, token]);

  useEffect(() => {
    if (checkedSession && (sessionUser || stored)) load();
  }, [checkedSession, sessionUser, stored, load]);

  function saveToken() {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      setStored(true);
      setError(null);
    }
  }

  function clearToken() {
    clearStoredToken();
    setToken("");
    setStored(false);
    setStatus(null);
  }

  async function logout() {
    try {
      await api.authLogout();
    } catch {
      /* ignore — clear locally regardless */
    }
    clearStoredToken();
    setSessionUser(null);
    router.replace("/admin/login");
  }

  async function triggerImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await api.adminImport(stored && token ? token : undefined);
      setImportMsg(`Import gestartet: ${res.message}`);
      setTimeout(load, 2000);
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : null;
      setImportMsg(`Fehler: ${msg}`);
    } finally {
      setImporting(false);
    }
  }

  // Not authenticated by session or token → go to the login page.
  if (checkedSession && !sessionUser && !stored) {
    return (
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="section-h">
          <h1 className="section-h__title">Admin</h1>
        </div>
        <div className="admin-card">
          <h3>Anmeldung erforderlich</h3>
          <p style={{ color: "var(--text-muted)", marginBottom: 14 }}>
            Bitte melde dich an, um auf den internen Bereich zuzugreifen.
          </p>
          <Link className="btn btn--primary" href="/admin/login">
            Zur Admin-Anmeldung
          </Link>
        </div>
      </div>
    );
  }

  const authed = Boolean(sessionUser) || stored;

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="section-h">
        <h1 className="section-h__title">Admin</h1>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: 20, fontSize: "0.92rem" }}>
        Interner Bereich. Die Anmeldung wird serverseitig geprüft; die Sitzung liegt in einem
        HttpOnly-Cookie. Der optionale Admin-Token bleibt für bestehende Clients nutzbar.
      </p>

      <div className="admin-card">
        <h3>Authentifizierung</h3>
        {sessionUser ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Angemeldet als <strong>{sessionUser}</strong>
            </span>
            <button className="btn" onClick={logout}>
              Abmelden
            </button>
          </div>
        ) : (
          <>
            {!showTokenForm ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link className="btn btn--primary" href="/admin/login">
                  Anmelden
                </Link>
                <button className="btn btn--ghost" onClick={() => setShowTokenForm(true)}>
                  Token verwenden
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 320px" }}>
                  <label htmlFor="admin-token" style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    ADMIN_TOKEN
                  </label>
                  <input
                    id="admin-token"
                    className="token-input"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Token eingeben …"
                    autoComplete="off"
                  />
                </div>
                <button className="btn btn--primary" onClick={saveToken}>
                  Speichern
                </button>
                {stored && (
                  <button className="btn" onClick={clearToken}>
                    Abmelden
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {authed && (
        <>
          <div className="admin-card">
            <h3>Import-Status</h3>
            {loading ? (
              <p style={{ color: "var(--text-muted)" }}>Lädt …</p>
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : status ? (
              <div className="kv">
                <span className="kv__k">Letzter erfolgreicher Import</span>
                <span className="kv__v">
                  {status.lastSuccess ? formatDateTime(status.lastSuccess.startedAt) : "—"} Uhr
                </span>
                <span className="kv__k">Sheets importiert</span>
                <span className="kv__v">{status.lastSuccess?.sheetsImported ?? "—"}</span>
                <span className="kv__k">IHK-Standorte</span>
                <span className="kv__v">{status.lastSuccess?.ihkLocations ?? "—"}</span>
                <span className="kv__k">Letzter Fehler</span>
                <span className="kv__v">{status.lastAttempt?.lastError ?? "—"}</span>
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>Keine Daten.</p>
            )}
          </div>

          <div className="admin-card">
            <h3>Scheduler</h3>
            <div className="kv">
              <span className="kv__k">Laufend</span>
              <span className="kv__v">{status?.scheduler.running ? "Ja" : "Nein"}</span>
              <span className="kv__k">Intervall</span>
              <span className="kv__v">{status?.scheduler.intervalHours} h</span>
            </div>
          </div>

          <div className="admin-card">
            <h3>Manueller Import</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 14, fontSize: "0.9rem" }}>
              Startet einen neuen Import-Lauf. Mutex-geschützt — läuft bereits ein Import, wird 409 zurückgegeben.
            </p>
            <button className="btn btn--primary" onClick={triggerImport} disabled={importing}>
              {importing ? "Läuft …" : "Import jetzt starten"}
            </button>
            {importMsg && (
              <p style={{ marginTop: 12, fontSize: "0.9rem", color: "var(--text-muted)" }}>{importMsg}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
