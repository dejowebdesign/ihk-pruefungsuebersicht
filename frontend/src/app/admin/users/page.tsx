"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, type ManagedUser, type UserRole } from "@/lib/api";
import { ErrorState } from "@/components/States";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useIdentity } from "@/lib/use-identity";
import { roleLabel } from "@/lib/auth";

const MIN_PASSWORD = 8;

export default function UsersPage() {
  const { user: me } = useIdentity();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("examiner");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // password reset
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [savingReset, setSavingReset] = useState(false);

  // deactivation
  const [pendingDisable, setPendingDisable] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.users();
      setUsers(res.data);
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Benutzer konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAdmins = users.filter((u) => u.role === "admin" && u.active);
  const isLastAdmin = (u: ManagedUser) => activeAdmins.length <= 1 && u.role === "admin" && u.active;

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const name = username.trim();
    if (!name) return setFormError("Bitte einen Benutzernamen eingeben.");
    if (password.length < MIN_PASSWORD) {
      return setFormError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
    }
    setCreating(true);
    try {
      await api.createUser({ username: name, password, role });
      setUsername("");
      setPassword("");
      setRole("examiner");
      setNotice(`Benutzer „${name}“ wurde angelegt.`);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof ApiClientError ? e.message : "Benutzer konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u: ManagedUser) {
    setRowError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.updateUser(u.id, { active: !u.active });
      setNotice(`Benutzer „${u.username}“ wurde ${u.active ? "deaktiviert" : "aktiviert"}.`);
      await load();
    } catch (e: unknown) {
      setRowError(e instanceof ApiClientError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
      setPendingDisable(null);
    }
  }

  async function submitReset() {
    if (!resetting) return;
    setResetError(null);
    if (newPassword.length < MIN_PASSWORD) {
      return setResetError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
    }
    setSavingReset(true);
    try {
      await api.updateUser(resetting.id, { password: newPassword });
      setNotice(
        `Passwort für „${resetting.username}“ wurde gesetzt. Bestehende Sitzungen wurden beendet.`,
      );
      setResetting(null);
      setNewPassword("");
    } catch (e: unknown) {
      setResetError(e instanceof ApiClientError ? e.message : "Passwort konnte nicht gesetzt werden.");
    } finally {
      setSavingReset(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div className="section-h">
        <div>
          <h1 className="section-h__title">Benutzerverwaltung</h1>
          <p className="muted">Prüferkonten anlegen, Passwörter zurücksetzen, Konten deaktivieren.</p>
        </div>
        <Link className="btn btn--ghost" href="/admin">
          ← Zur Verwaltung
        </Link>
      </div>

      <form className="admin-card user-form" onSubmit={createUser} aria-label="Neuen Benutzer anlegen">
        <h3>Neuen Benutzer anlegen</h3>
        <div className="user-form__row">
          <div className="oral-field">
            <label htmlFor="new-username">Benutzername</label>
            <input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="oral-field">
            <label htmlFor="new-password">Passwort (min. {MIN_PASSWORD} Zeichen)</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="oral-field">
            <label htmlFor="new-role">Rolle</label>
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="examiner">Prüfer</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <button className="btn btn--primary" type="submit" disabled={creating}>
            {creating ? "Anlegen …" : "Benutzer anlegen"}
          </button>
        </div>
        {formError && (
          <p className="state" role="alert" style={{ padding: 10 }}>
            {formError}
          </p>
        )}
      </form>

      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {rowError && (
        <p className="state" role="alert" style={{ padding: 10 }}>
          {rowError}
        </p>
      )}

      {loading ? (
        <p className="muted">Benutzer werden geladen …</p>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <section className="admin-card" style={{ marginTop: 20, padding: 0 }}>
          <table className="oral-table">
            <thead>
              <tr>
                <th>Benutzername</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Angelegt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {me?.username === u.username && <span className="badge-soft">Sie</span>}
                  </td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    <span className={`oral-status oral-status--${u.active ? "completed" : "draft"}`}>
                      {u.active ? "Aktiv" : "Deaktiviert"}
                    </span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString("de-DE")}</td>
                  <td>
                    <div className="oral-row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setResetError(null);
                          setNewPassword("");
                          setResetting(u);
                        }}
                      >
                        Passwort setzen
                      </button>
                      <button
                        type="button"
                        className={`btn btn--sm ${u.active ? "btn--danger-ghost" : "btn--ghost"}`}
                        disabled={busy || isLastAdmin(u)}
                        title={
                          isLastAdmin(u)
                            ? "Das letzte aktive Administratorkonto kann nicht deaktiviert werden."
                            : undefined
                        }
                        onClick={() => (u.active ? setPendingDisable(u) : toggleActive(u))}
                      >
                        {u.active ? "Deaktivieren" : "Aktivieren"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ConfirmDialog
        open={resetting !== null}
        title="Passwort setzen"
        confirmLabel="Passwort speichern"
        busy={savingReset}
        onConfirm={() => void submitReset()}
        onCancel={() => setResetting(null)}
        message={
          <div className="oral-field">
            <p>
              Neues Passwort für <strong>{resetting?.username}</strong>. Bestehende Sitzungen dieses
              Benutzers werden beendet.
            </p>
            <label htmlFor="reset-password">Neues Passwort (min. {MIN_PASSWORD} Zeichen)</label>
            <input
              id="reset-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {resetError && (
              <p className="login-error" role="alert">
                {resetError}
              </p>
            )}
          </div>
        }
      />

      <ConfirmDialog
        open={pendingDisable !== null}
        danger
        busy={busy}
        title="Konto deaktivieren?"
        confirmLabel="Deaktivieren"
        onConfirm={() => pendingDisable && toggleActive(pendingDisable)}
        onCancel={() => setPendingDisable(null)}
        message={
          <>
            <p>
              Das Konto <strong>{pendingDisable?.username}</strong> kann sich danach nicht mehr
              anmelden. Laufende Sitzungen werden sofort ungültig.
            </p>
            <p className="modal__hint">
              Das Konto bleibt erhalten und kann jederzeit wieder aktiviert werden.
            </p>
          </>
        }
      />
    </div>
  );
}
